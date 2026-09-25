// =============================================
// utils/jointCostAllocation.js
// "1 chicken becomes many sellable parts" - fixed-recovery lines
// (minor scrap by-products) net off first; whatever cost remains
// splits PROPORTIONALLY across the main output and every joint-basis
// line together, weighted by relative value (or qty) - the standard
// "Relative Sales Value Method" from cost accounting.
// =============================================

function computeJointAllocation(totalRawMaterialCost, mainOutput, byproductLines) {
    const fixedLines = byproductLines.filter(l => l.allocation_basis === 'fixed_recovery');
    const jointLines = byproductLines.filter(l => l.allocation_basis !== 'fixed_recovery');

    const fixedRecoveryValue = fixedLines.reduce((s, l) => s + Number(l.qty) * Number(l.recovery_rate || 0), 0);
    const netCost = totalRawMaterialCost - fixedRecoveryValue;

    if (jointLines.length === 0) {
        const outputUnitCost = Number(mainOutput.qty) > 0 ? netCost / Number(mainOutput.qty) : 0;
        return { fixedRecoveryValue, netCost, mainOutputCost: netCost, mainOutputUnitCost: outputUnitCost, jointAllocations: [] };
    }

    // Weight by relative value (qty * relative_value) when ANY
    // participant actually has one set; otherwise fall back to plain
    // qty so a document with no relative_value entered yet never
    // silently zeroes the main output out.
    const anyRelativeValueSet = Number(mainOutput.relative_value || 0) > 0 || jointLines.some(l => Number(l.relative_value || 0) > 0);
    const weight = (l) => anyRelativeValueSet ? Number(l.qty) * Number(l.relative_value || 0) : Number(l.qty);
    const mainWeight = weight(mainOutput);
    const totalWeight = mainWeight + jointLines.reduce((s, l) => s + weight(l), 0);

    const allocate = (w) => totalWeight > 0 ? Math.round(netCost * (w / totalWeight) * 100) / 100 : 0;

    const mainOutputCost = allocate(mainWeight);
    const jointAllocations = jointLines.map(l => {
        const cost = allocate(weight(l));
        return { ...l, allocatedCost: cost, unitCost: Number(l.qty) > 0 ? Math.round((cost / Number(l.qty)) * 10000) / 10000 : 0 };
    });

    return {
        fixedRecoveryValue, netCost,
        mainOutputCost, mainOutputUnitCost: Number(mainOutput.qty) > 0 ? Math.round((mainOutputCost / Number(mainOutput.qty)) * 10000) / 10000 : 0,
        jointAllocations
    };
}

module.exports = { computeJointAllocation };
