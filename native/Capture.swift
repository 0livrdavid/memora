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
// Persistent CoreAudio namespace and lease must interoperate with existing installations.
let stableCaptureUID = "local.sonora.capture"
var tap = AudioObjectID(0), aggregate = AudioObjectID(0)
var activeSource = "", activeGeneration = ""
var activeResult: [String: Any] = [:]
var lease: Int32 = -1
func acquireLease() throws {
    if lease >= 0 { return }
    let file = (NSTemporaryDirectory() as NSString).appendingPathComponent("local.sonora.memora.capture.\(getuid()).lock")
    let fd = open(file, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard fd >= 0 else { throw Failure("Não foi possível proteger a captura única.") }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
          flock(fd, LOCK_EX | LOCK_NB) == 0 else {
        close(fd); throw Failure("Outro processo Memora ainda controla o áudio. Aguarde o encerramento antes de tentar novamente.")
    }
    lease = fd // Released by the OS on exit/crash. Never unlink a held lock.
}
func deviceExists(_ id: AudioObjectID) throws -> Bool {
    try objects(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDevices).contains(id)
}
func destroyAggregate(_ id: AudioObjectID) throws {
    if try !deviceExists(id) { return }
    try check(AudioHardwareDestroyAggregateDevice(id), "Remover entrada temporária")
    for _ in 0..<50 {
        if try !deviceExists(id) { return }
        Thread.sleep(forTimeInterval: 0.02)
    }
    throw Failure("O macOS ainda não liberou a entrada Memora. Nenhuma outra entrada foi criada.")
}
func stop() throws {
    if aggregate != 0 { try destroyAggregate(aggregate); aggregate = 0 }
    if tap != 0 { try check(AudioHardwareDestroyProcessTap(tap), "Remover captura do áudio"); tap = 0 }
    activeSource = ""; activeGeneration = ""; activeResult = [:]
}
func composition(_ id: AudioObjectID) throws -> [String: Any] {
    var property = address(kAudioAggregateDevicePropertyComposition), value: Unmanaged<CFDictionary>? = nil
    var size = UInt32(MemoryLayout<CFDictionary?>.size)
    try check(AudioObjectGetPropertyData(id, &property, 0, nil, &size, &value), "Preservar configuração da entrada")
    guard let result = value?.takeRetainedValue() as? [String: Any] else { throw Failure("Configuração da entrada indisponível.") }
    return result
}
func reclaimOwned() throws -> [String] {
    try acquireLease()
    let system = AudioObjectID(kAudioObjectSystemObject)
    let defaults = try [kAudioHardwarePropertyDefaultInputDevice, kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDefaultSystemOutputDevice].map { try number(system, $0, AudioObjectID(0)) }
    let owned = try objects(system, kAudioHardwarePropertyDevices).filter { id in
        guard let uid = try? string(id, kAudioDevicePropertyDeviceUID) else { return false }
        return isOwnCapture(uid)
    }
    var candidates: [(AudioObjectID, String, [String: Any])] = []
    // Validate the complete set before removing anything. Never touch user routes or drivers.
    for id in owned {
        let uid = try string(id, kAudioDevicePropertyDeviceUID), name = try string(id, kAudioObjectPropertyName)
        guard try number(id, kAudioObjectPropertyClass, UInt32(0)) == kAudioAggregateDeviceClassID,
              !defaults.contains(id), try number(id, kAudioDevicePropertyDeviceIsRunningSomewhere, UInt32(0)) == 0 else {
            throw Failure("Uma entrada do Memora está em uso ou configurada como padrão. Nenhuma entrada nova foi criada.")
        }
        if name.hasPrefix("Memora Capture "), let raw = name.split(separator: " ").dropFirst(2).first, let pid = Int32(raw), kill(pid, 0) == 0 || errno == EPERM {
            var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
            guard proc_pidpath(pid, &path, UInt32(path.count)) > 0 else { throw Failure("Não foi possível verificar o processo de uma captura anterior.") }
            // PIDs are recycled across reboots; an unrelated live process is not a capture owner.
            let executable = String(cString: path)
            // Recognize active helpers from both current and legacy builds.
            if ["memora-capture", "sonora-capture"].contains(URL(fileURLWithPath: executable).lastPathComponent) {
                throw Failure("Uma captura anterior ainda tem processo ativo. Encerre esse Memora antes de tentar novamente.")
            }
        }
        candidates.append((id, uid, try composition(id)))
    }
    if !candidates.isEmpty {
        let base = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.deletingLastPathComponent().appendingPathComponent("device-backups", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONSerialization.data(withJSONObject: ["at": ISO8601DateFormatter().string(from: Date()), "devices": candidates.map { ["uid": $0.1, "composition": $0.2] }], options: [.sortedKeys])
        let target = base.appendingPathComponent(UUID().uuidString + ".json")
        try data.write(to: target, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
    }
    for (id, uid, _) in candidates {
        guard try string(id, kAudioDevicePropertyDeviceUID) == uid else { throw Failure("A identidade da entrada mudou. Limpeza interrompida.") }
        try destroyAggregate(id)
    }
    return candidates.map { $0.1 }
}
func validate(_ identity: [String: Any]) throws -> [String: Any] {
    guard aggregate != 0, tap != 0, try deviceExists(aggregate),
          try string(aggregate, kAudioDevicePropertyDeviceUID) == stableCaptureUID,
          identity["uid"] as? String == stableCaptureUID,
          identity["generation"] as? String == activeGeneration,
          identity["sourceUID"] as? String == activeSource,
          !activeGeneration.isEmpty else { throw Failure("A geração da captura mudou. Atualize as fontes antes de iniciar.") }
    return ["valid": true]
}
func shouldExclude(bundle: String, pid: pid_t) -> Bool {
    return bundle.hasPrefix("com.github.Electron") || bundle == "local.sonora.memora" || bundle.hasPrefix("local.sonora.memora.") || bundle == "local.sonora.capture" || pid == getpid() || pid == getppid()
}
@available(macOS 26.0, *)
func start(_ uid: String) throws -> [String: Any] {
    try acquireLease()
    if aggregate != 0 && activeSource == uid && (try? validate(activeResult)) != nil { return activeResult }
    try stop()
    let list = try inventory()["devices"] as? [[String: Any]] ?? []
    guard list.contains(where: { ($0["uid"] as? String) == uid && ($0["captureEligible"] as? Bool) == true }) else { throw Failure("Escolha uma saída disponível. A entrada temporária do próprio Memora não pode ser usada como saída.") }
    _ = try reclaimOwned()
    var excluded: [AudioObjectID] = []
    var bundleIDs = Set(["com.github.Electron", "com.github.Electron.helper", "com.github.Electron.helper.Renderer", "local.sonora.memora", "local.sonora.capture"])
    for object in try objects(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) {
        let bundle = (try? string(object, kAudioProcessPropertyBundleID)) ?? ""
        let pid = (try? number(object, kAudioProcessPropertyPID, pid_t(0))) ?? 0
        if shouldExclude(bundle: bundle, pid: pid) {
            excluded.append(object)
            if !bundle.isEmpty { bundleIDs.insert(bundle) }
        }
    }
    let description = CATapDescription(excludingProcesses: excluded, deviceUID: uid, stream: 0)
    description.name = "Memora · registro do computador"
    description.isPrivate = false
    description.muteBehavior = .unmuted
    description.bundleIDs = Array(bundleIDs)
    description.isProcessRestoreEnabled = true
    try check(AudioHardwareCreateProcessTap(description, &tap), "Criar captura do áudio")
    do {
        let generation = UUID().uuidString
        let captureUID = stableCaptureUID
        let name = "Memora"
        let composition: [String: Any] = [
            kAudioAggregateDeviceNameKey: name,
            kAudioAggregateDeviceUIDKey: captureUID,
            kAudioAggregateDeviceIsPrivateKey: false,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
        ]
        try check(AudioHardwareCreateAggregateDevice(composition as CFDictionary, &aggregate), "Criar entrada temporária")
        activeSource = uid; activeGeneration = generation
        activeResult = ["generation": generation, "label": name, "uid": captureUID, "sourceUID": uid, "excludedBundles": Array(bundleIDs).sorted(), "unmuted": true, "mode": "record", "sourceVirtual": list.first(where: { ($0["uid"] as? String) == uid })?["virtual"] as? Bool ?? false, "scope": "selected-device-stream-0"]
        return activeResult
    } catch { let original = error; try stop(); throw original }
}
func reply(_ id: Any, _ result: [String: Any]? = nil, _ error: String? = nil) {
    var value: [String: Any] = ["id": id]
    if let error { value["error"] = error } else { value["result"] = result ?? [:] }
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
    }
}
if CommandLine.arguments.contains("--policy-test") {
    let discordRecorded = !shouldExclude(bundle: "com.hnc.Discord.helper", pid: -1)
    let chromeRecorded = !shouldExclude(bundle: "com.google.Chrome.helper", pid: -1)
    let selfExcluded = shouldExclude(bundle: "com.github.Electron", pid: -1)
    let virtualOutputAccepted = canTapOutput(uid: "Perssua_UID", outputChannels: 2)
    let selfTapRejected = !canTapOutput(uid: "local.sonora.capture.fixture", outputChannels: 2)
    let inputOnlyRejected = !canTapOutput(uid: "microphone", outputChannels: 0)
    reply(0, ["passed": discordRecorded && chromeRecorded && selfExcluded && virtualOutputAccepted && selfTapRejected && inputOnlyRejected, "discordIncludedInRecord": discordRecorded, "chromeIncludedInRecord": chromeRecorded, "selfExcluded": selfExcluded, "captureStarted": false, "virtualOutputAccepted": virtualOutputAccepted, "selfTapRejected": selfTapRejected, "inputOnlyRejected": inputOnlyRejected])
    exit(discordRecorded && chromeRecorded && selfExcluded && virtualOutputAccepted && selfTapRejected && inputOnlyRejected ? 0 : 1)
}
if CommandLine.arguments.contains("--list") {
    do { reply(0, try inventory()) } catch { reply(0, nil, String(describing: error)); exit(1) }
    exit(0)
}
for sig in [SIGTERM, SIGINT] { signal(sig, SIG_IGN) }
var signals: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { do { try stop(); exit(0) } catch { fputs("Memora cleanup failed: \(error)\n", stderr); exit(1) } }; source.resume(); signals.append(source)
}
DispatchQueue.global().async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
        DispatchQueue.main.async {
            let id = command["id"] ?? 0
            do {
                switch command["command"] as? String {
                case "list": reply(id, try inventory())
                case "start":
                    guard #available(macOS 26.0, *) else { throw Failure("Esta versão da captura com exclusão automática requer macOS 26 ou superior.") }
                    reply(id, try start(command["uid"] as? String ?? ""))
                case "stop": try stop(); reply(id)
                case "validate": reply(id, try validate(command["identity"] as? [String: Any] ?? [:]))
                case "cleanup-owned":
                    guard aggregate == 0 && tap == 0 else { throw Failure("Pare a captura antes de limpar entradas antigas.") }
                    reply(id, ["removed": try reclaimOwned()])
                default: throw Failure("Comando de áudio inválido.")
                }
            } catch { reply(id, nil, String(describing: error)) }
        }
    }
    DispatchQueue.main.async { do { try stop(); exit(0) } catch { fputs("Memora cleanup failed: \(error)\n", stderr); exit(1) } }
}
dispatchMain()
