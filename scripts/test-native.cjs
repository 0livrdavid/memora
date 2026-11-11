const assert = require('node:assert/strict');
const { CaptureBridge } = require('../src/native.cjs');
(async () => {
  const bridge = new CaptureBridge();
  try {
    const before = await bridge.request('list');
    const source = before.devices.find(device => device.isDefault && !device.virtual && device.outputChannels > 0) || before.devices.find(device => !device.virtual && device.outputChannels > 0);
    assert.ok(source, 'saída física disponível');
    const capture = await bridge.request('start', source.uid);
    const during = await bridge.request('list');
    assert.ok(during.devices.some(device => device.uid === capture.uid && device.inputChannels > 0), 'entrada de captura publicada');
    assert.ok(!capture.excludedBundles.includes('com.hnc.Discord'));
    assert.ok(capture.excludedBundles.includes('com.github.Electron'));
    assert.equal(capture.unmuted, true);
    assert.equal(during.devices.find(device => device.isDefault)?.uid, before.devices.find(device => device.isDefault)?.uid);
    await bridge.request('stop');
    const after = await bridge.request('list');
    assert.ok(!after.devices.some(device => device.uid === capture.uid), 'entrada temporária removida');
    await assert.rejects(bridge.request('start', 'dispositivo-inexistente'), /saída física/);
    console.log(JSON.stringify({ passed: true, source: source.label, capturePublished: true, includesDiscord: true, excludesMemora: true, playbackUnmuted: true, defaultUnchanged: true, captureRemoved: true, invalidDeviceBlocked: true }, null, 2));
  } finally { bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
