// Manual controlled diagnostic only; not invoked by npm test. Includes only its synthetic child process, never microphone.
import Foundation
import CoreAudio
import Darwin

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
func check(_ status: OSStatus, _ action: String) throws {
    if status != noErr { throw Failure("\(action) (Core Audio \(status)).") }
}
func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func number<T: FixedWidthInteger>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T) throws -> T {
    var property = address(selector), value = initial, size = UInt32(MemoryLayout<T>.size)
    try check(AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value), "Ler propriedade")
    return value
}
func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> String {
    var property = address(selector), value: Unmanaged<CFString>? = nil, size = UInt32(MemoryLayout<CFString>.size)
    try check(AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value), "Ler identificação")
    guard let value else { throw Failure("Identificação do dispositivo indisponível.") }; return value.takeRetainedValue() as String
}
func objects(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> [AudioObjectID] {
    var property = address(selector), size: UInt32 = 0
    try check(AudioObjectGetPropertyDataSize(object, &property, 0, nil, &size), "Listar objetos")
    var result = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    try result.withUnsafeMutableBytes { bytes in
        if let base = bytes.baseAddress { try check(AudioObjectGetPropertyData(object, &property, 0, nil, &size, base), "Ler objetos") }
    }
    return result
}
func channels(_ device: AudioObjectID, _ scope: AudioObjectPropertyScope) -> Int {
    var property = address(kAudioDevicePropertyStreamConfiguration, scope), size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &property, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let memory = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { memory.deallocate() }
    guard AudioObjectGetPropertyData(device, &property, 0, nil, &size, memory) == noErr else { return 0 }
    return UnsafeMutableAudioBufferListPointer(memory.assumingMemoryBound(to: AudioBufferList.self)).reduce(0) { $0 + Int($1.mNumberChannels) }
}
func nominalRate(_ device: AudioObjectID) -> Double {
    var property = address(kAudioDevicePropertyNominalSampleRate), rate = Double(0), size = UInt32(MemoryLayout<Double>.size)
    guard AudioObjectGetPropertyData(device, &property, 0, nil, &size, &rate) == noErr else { return 0 }
    return rate
}
func isOwnCapture(_ uid: String) -> Bool { uid == "local.sonora.capture" || uid.hasPrefix("local.sonora.capture.") }
func canTapOutput(uid: String, outputChannels: Int) -> Bool { !uid.isEmpty && outputChannels > 0 && !isOwnCapture(uid) }
func inventory() throws -> [String: Any] {
    let system = AudioObjectID(kAudioObjectSystemObject)
    let defaultID = try number(system, kAudioHardwarePropertyDefaultOutputDevice, AudioObjectID(0))
    let list = try objects(system, kAudioHardwarePropertyDevices).compactMap { device -> [String: Any]? in
        guard let uid = try? string(device, kAudioDevicePropertyDeviceUID), let name = try? string(device, kAudioObjectPropertyName) else { return nil }
        let transport = (try? number(device, kAudioDevicePropertyTransportType, UInt32(0))) ?? 0
        let outputChannels = channels(device, kAudioObjectPropertyScopeOutput)
        return ["uid": uid, "label": name, "sampleRate": nominalRate(device), "inputChannels": channels(device, kAudioObjectPropertyScopeInput), "outputChannels": outputChannels, "virtual": transport == kAudioDeviceTransportTypeVirtual, "ownedCapture": isOwnCapture(uid), "captureEligible": canTapOutput(uid: uid, outputChannels: outputChannels), "isDefault": device == defaultID]
    }
    return ["devices": list, "supported": ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26]
}

import AudioToolbox

let toneHz = 697.0
var phase = 0.0
let toneCallback: AudioQueueOutputCallback = { _, queue, buffer in
    let frames = 1024
    let samples = buffer.pointee.mAudioData.assumingMemoryBound(to: Float32.self)
    for i in 0..<frames {
        let sample = Float32(sin(phase) * 0.015)
        samples[2*i] = sample; samples[2*i+1] = sample
        phase += 2 * Double.pi * toneHz / 48000
    }
    buffer.pointee.mAudioDataByteSize = UInt32(frames * 8)
    AudioQueueEnqueueBuffer(queue, buffer, 0, nil)
}
func tone(_ uid: String) throws {
    var format = AudioStreamBasicDescription(mSampleRate:48000,mFormatID:kAudioFormatLinearPCM,mFormatFlags:kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked,mBytesPerPacket:8,mFramesPerPacket:1,mBytesPerFrame:8,mChannelsPerFrame:2,mBitsPerChannel:32,mReserved:0)
    var queue: AudioQueueRef?
    try check(AudioQueueNewOutput(&format,toneCallback,nil,nil,nil,0,&queue),"Create controlled tone queue")
    guard let queue else { throw Failure("Missing tone queue") }
    defer { AudioQueueStop(queue,true);AudioQueueDispose(queue,true) }
    var device = uid as CFString
    try check(AudioQueueSetProperty(queue,kAudioQueueProperty_CurrentDevice,&device,UInt32(MemoryLayout<CFString>.size)),"Bind controlled queue to requested virtual device")
    for _ in 0..<3 {
        var buffer: AudioQueueBufferRef?
        try check(AudioQueueAllocateBuffer(queue,8192,&buffer),"Allocate controlled buffer")
        if let buffer { toneCallback(nil,queue,buffer) }
    }
    try check(AudioQueueStart(queue,nil),"Start controlled tone")
    RunLoop.current.run(until:Date(timeIntervalSinceNow:4))
}
final class Stats {
    var frames = 0; var peak = 0.0; var sum = 0.0; var re = 0.0; var im = 0.0; var rate = 48000.0
    let lock = NSLock()
}
let stats = Stats()
let inputCallback: AudioDeviceIOProc = { _,_,input,_,_,_,_ in
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating:input))
    guard let buffer = buffers.first, let data = buffer.mData else { return noErr }
    let values = data.assumingMemoryBound(to:Float32.self), channels = max(1,Int(buffer.mNumberChannels))
    let frames = Int(buffer.mDataByteSize)/4/channels
    stats.lock.lock()
    for i in 0..<frames {
        let sample = Double(values[i*channels]);let angle = 2*Double.pi*toneHz*Double(stats.frames)/stats.rate
        stats.peak = max(stats.peak,abs(sample));stats.sum += sample*sample
        stats.re += sample*cos(angle);stats.im += sample*sin(angle);stats.frames += 1
    }
    stats.lock.unlock();return noErr
}
func controlledTest(_ uid: String) throws -> [String:Any] {
    let before = try inventory(),defaultBefore=(before["devices"] as? [[String:Any]])?.first(where:{$0["isDefault"] as? Bool == true})?["uid"] as? String
    guard (before["devices"] as? [[String:Any]])?.contains(where:{$0["uid"] as? String == uid && $0["captureEligible"] as? Bool == true}) == true else { throw Failure("Requested virtual output unavailable; no audio test started") }
    let child=Process();child.executableURL=URL(fileURLWithPath:CommandLine.arguments[0]);child.arguments=["--tone",uid];child.standardOutput=FileHandle.nullDevice;child.standardError=FileHandle.nullDevice
    try child.run();defer { if child.isRunning { child.terminate();child.waitUntilExit() } }
    var processObject=AudioObjectID(0)
    for _ in 0..<20 {
        var property=address(kAudioHardwarePropertyTranslatePIDToProcessObject),pid=child.processIdentifier,size=UInt32(MemoryLayout<AudioObjectID>.size)
        try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),&property,UInt32(MemoryLayout<pid_t>.size),&pid,&size,&processObject),"Resolve only the controlled tone process")
        if processObject != 0 {break};Thread.sleep(forTimeInterval:0.1)
    }
    guard processObject != 0 else {throw Failure("Controlled tone process unavailable")}
    let description=CATapDescription(processes:[processObject],deviceUID:uid,stream:0)
    description.name="Memora controlled virtual diagnostic";description.isPrivate=true;description.muteBehavior = .unmuted
    var tap=AudioObjectID(0),aggregate=AudioObjectID(0);var proc:AudioDeviceIOProcID?
    defer {if aggregate != 0 { if let proc {AudioDeviceStop(aggregate,proc);AudioDeviceDestroyIOProcID(aggregate,proc)};AudioHardwareDestroyAggregateDevice(aggregate)};if tap != 0 {AudioHardwareDestroyProcessTap(tap)}}
    try check(AudioHardwareCreateProcessTap(description,&tap),"Create selected-device tap of controlled process only")
    var format=AudioStreamBasicDescription(),property=address(kAudioTapPropertyFormat),size=UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    try check(AudioObjectGetPropertyData(tap,&property,0,nil,&size,&format),"Read tap format")
    guard format.mFormatID==kAudioFormatLinearPCM && format.mBitsPerChannel==32 && format.mFormatFlags & kAudioFormatFlagIsFloat != 0 else {throw Failure("Unexpected tap sample format")}
    stats.rate=format.mSampleRate
    let uidTemporary="local.sonora.capture.controlled-"+UUID().uuidString
    let composition:[String:Any]=[kAudioAggregateDeviceNameKey:"Memora controlled diagnostic",kAudioAggregateDeviceUIDKey:uidTemporary,kAudioAggregateDeviceIsPrivateKey:true,kAudioAggregateDeviceTapListKey:[[kAudioSubTapUIDKey:description.uuid.uuidString,kAudioSubTapDriftCompensationKey:true]]]
    try check(AudioHardwareCreateAggregateDevice(composition as CFDictionary,&aggregate),"Create private diagnostic input")
    try check(AudioDeviceCreateIOProcID(aggregate,inputCallback,nil,&proc),"Create nonrecording signal analyzer")
    guard let proc else {throw Failure("Missing diagnostic IO proc")}
    try check(AudioDeviceStart(aggregate,proc),"Start controlled signal analyzer")
    Thread.sleep(forTimeInterval:1.2)
    try check(AudioDeviceStop(aggregate,proc),"Stop controlled signal analyzer")
    let after=try inventory(),defaultAfter=(after["devices"] as? [[String:Any]])?.first(where:{$0["isDefault"] as? Bool == true})?["uid"] as? String
    stats.lock.lock();let n=stats.frames,peak=stats.peak,rms=sqrt(stats.sum/Double(max(1,n))),amplitude=2*hypot(stats.re,stats.im)/Double(max(1,n));stats.lock.unlock()
    return ["sourceUID":uid,"virtual":true,"onlyControlledProcessIncluded":true,"microphoneOpened":false,"framesAnalyzed":n,"sampleRate":stats.rate,"peak":peak,"rms":rms,"amplitudeAt697Hz":amplitude,"expectedToneHz":toneHz,"passed":n>1000 && peak>0.0001 && amplitude>0.0001,"defaultOutputUnchanged":defaultBefore==defaultAfter,"audioFilesWritten":false,"meetingRecordingStarted":false]
}
do {
    if CommandLine.arguments.count>2 && CommandLine.arguments[1]=="--tone" {try tone(CommandLine.arguments[2])}
    else {
        let result=try controlledTest("Perssua_UID")
        let encoded=try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]);FileHandle.standardOutput.write(encoded);FileHandle.standardOutput.write(Data([10]))
        exit(result["passed"] as? Bool == true ? 0:2)
    }
} catch {
    let encoded=try! JSONSerialization.data(withJSONObject:["error":String(describing:error),"meetingRecordingStarted":false,"audioFilesWritten":false]);FileHandle.standardOutput.write(encoded);FileHandle.standardOutput.write(Data([10]));exit(1)
}
