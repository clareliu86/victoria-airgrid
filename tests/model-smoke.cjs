// Execute the actual route and fleet functions without a browser or third-party test runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const rfz = fs.readFileSync(path.join(root, 'data/rfz_data.js'), 'utf8');
const part = (begin, end) => app.slice(app.indexOf(begin), app.indexOf(end));
const dom = { classList: { toggle() {} } };
const map = { on() {}, getZoom() { return 14; } };
const L = {
    map() { return map; }, control: { zoom() { return { addTo() {} }; } },
    tileLayer() { return { addTo() {} }; },
};
const context = vm.createContext({ L, document: { getElementById() { return dom; } }, console });
vm.runInContext(rfz, context);
vm.runInContext(part('// ======================================================================', '// ---------- 8. Layers ----------'), context);
vm.runInContext(part('const isCrossHarbourOD', '(function initPierSelectors()'), context);
vm.runInContext('const UNLOAD_S = 30, APPROACH_F = 0.5;', context);
vm.runInContext(part('const slotHalf', 'function currentEdgeCounts()'), context);
vm.runInContext(part('function fleetParams()', 'const FL ='), context);
vm.runInContext(part('function mulberry32(', 'function batchRun('), context);
vm.runInContext('const LEVEL_E_DESC = LEVEL_ALT[LEVEL_E] / UAV.v_descent;', context);
vm.runInContext(part('function emergencyDivert(', 'function showLayerModel()'), context);

const checked = vm.runInContext(`(() => {
    windModel.temp = 15;
    const anchors = [0, 9, 14].map(v => { UAV.v_air = v; return powerModel(0, 0).P_cruise; });
    UAV.v_air = 15;
    const noLoad = powerModel(0, 0).P_cruise, loaded = powerModel(0, 0.1).P_cruise;
    const routes = odRoutes.map(o => ({ name: o.name, plan: aStar(o.from, o.to, {}) }));
    const P = { n: 2, bat: UAV.battery_Wh, chg: 0.1, charge90Min: 60, chargeFullMin: 78,
        targetSoc: 0.9, spares: 2, hubs: 1, swapSec: 60, payloadKg: 0.1,
        rate: 0.5, dur: 120, seed: 2026, strat: 'none', tgt: 2 };
    const r = fleetSim(P);
    const emergency = emergencyResponseTest();
    return { anchors, noLoad, loaded, routes: routes.map(x => ({ name: x.name,
        energy: x.plan?.E_Wh, feasible: x.plan?.feasibleBattery })), r, emergency };
})()`, context);

const [hover, flight9, flight14] = checked.anchors;
assert.ok(Math.abs(hover - 99.5 * 60 / 42) < 1e-6);
assert.ok(Math.abs(flight9 - 99.5 * 60 / 49) < 1e-6);
assert.ok(Math.abs(flight14 - 99.5 * 3600 / (35000 / 14)) < 1e-6);
assert.ok(checked.loaded > checked.noLoad, 'payload must increase required power');
const feasible = checked.routes.filter(x => x.feasible).length;
assert.ok(feasible > 0, 'at least one cross-harbour route must remain battery-feasible');
assert.ok(checked.emergency.attempted > 0, 'emergency test must cover cruise-leg midpoints');
assert.equal(checked.emergency.rows.length + checked.emergency.withoutDiversion, checked.emergency.attempted);
assert.ok(checked.emergency.rows.every(x => Number.isFinite(x.tE) && x.tE > 0));

const r = checked.r;
const batteries = [...r.uavs.map(u => u.battery).filter(Boolean), ...Object.values(r.pool).flat()];
assert.equal(batteries.length, r.batteryCount, 'physical battery inventory must be conserved');
assert.equal(new Set(batteries.map(b => b.id)).size, r.batteryCount, 'battery IDs must be unique');
assert.ok(r.maxHubUse <= r.P.hubs, 'charging cannot exceed the hubs at a pier');
assert.ok(r.uavs.every(u => !u.battery || u.battery.state !== 'charging'), 'installed batteries cannot charge');
assert.ok(r.uavs.some(u => u.swaps > 0), 'at least one battery swap should occur');
assert.ok(r.served.length > 0, 'the fleet should complete a delivery');
assert.ok(r.series.every(s => s.soc >= 0 && s.soc <= 100.001), 'inventory state of charge must stay bounded');

for (const variant of [
    { label: 'default demand and proactive balancing', rate: 2, strat: 'proactive' },
    { label: 'no spare batteries and full-charge target', spares: 0, targetSoc: 1, rate: 0.5 },
]) {
    context.testP = { ...r.P, ...variant };
    const result = vm.runInContext('fleetSim(testP)', context);
    const stock = [...result.uavs.map(u => u.battery).filter(Boolean), ...Object.values(result.pool).flat()];
    assert.equal(stock.length, result.batteryCount, `${variant.label}: battery count`);
    assert.equal(new Set(stock.map(b => b.id)).size, result.batteryCount, `${variant.label}: battery IDs`);
    assert.ok(result.maxHubUse <= result.P.hubs, `${variant.label}: hub capacity`);
    assert.ok(result.uavs.every(u => !u.battery || u.battery.state !== 'charging'), `${variant.label}: in-aircraft charging`);
    assert.ok(result.served.length <= result.orders.length, `${variant.label}: delivered count`);
    assert.ok(result.served.every(o => o.tArr <= result.P.dur * 60), `${variant.label}: touchdown within window`);
    assert.ok(stock.every(b => b.wh >= -1e-6 && b.wh <= result.P.bat + 1e-6), `${variant.label}: battery energy bounds`);
    if (variant.spares === 0) {
        assert.ok(result.chargesCompleted > 0, 'a spent battery should recharge without a spare');
        assert.ok(result.uavs.some(u => u.swaps > 0), 'an aircraft should reuse a recharged battery');
    }
}
vm.runInContext(`windModel.loaded = true;
    windModel.stations = HKO_STATIONS.map(s => ({ ...s, h: s.hAnem, V: 30, dir: 90, gust: 35 }));`, context);
context.testP = { ...r.P, rate: 0.5, strat: 'reactive' };
const storm = vm.runInContext('fleetSim(testP)', context);
assert.equal(storm.served.length, 0, 'extreme-wind routes must not launch');
assert.equal(storm.infeasible, storm.orders.length, 'unserviceable orders must be counted');

console.log(JSON.stringify({ feasibleRoutes: feasible, totalRoutes: checked.routes.length,
    longestRouteWh: Math.max(...checked.routes.map(x => x.energy || 0)).toFixed(1),
    delivered: r.served.length, orders: r.orders.length, batteries: r.batteryCount,
    chargesCompleted: r.chargesCompleted, maxHubUse: r.maxHubUse,
    swaps: r.uavs.reduce((n, u) => n + u.swaps, 0), emergency: {
        tested: checked.emergency.attempted, feasible: checked.emergency.rows.length,
    } }, null, 2));
