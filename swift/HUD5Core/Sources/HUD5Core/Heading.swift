import Foundation

/// Smallest signed angular delta (degrees) from `fromDeg` to `toDeg`, in
/// (-180, 180]. Port of `shortestAngleDeltaDeg` from src/util/heading.ts.
public func shortestAngleDeltaDeg(from fromDeg: Double, to toDeg: Double) -> Double {
    (((toDeg - fromDeg).truncatingRemainder(dividingBy: 360) + 540)
        .truncatingRemainder(dividingBy: 360)) - 180
}

/// Exponential angle smoothing toward a target, time-constant based so it is
/// frame-rate independent. Snaps on large time jumps and holds when no time
/// has elapsed. Port of `smoothAngleDeg` from src/util/heading.ts.
public func smoothAngleDeg(
    current currentDeg: Double,
    target targetDeg: Double,
    deltaTime deltaTimeSec: Double,
    timeConstant timeConstantSec: Double
) -> Double {
    guard currentDeg.isFinite, targetDeg.isFinite, deltaTimeSec.isFinite else {
        return targetDeg
    }

    if deltaTimeSec <= 0 { return currentDeg }
    if deltaTimeSec > 1 { return targetDeg }

    let tau = max(timeConstantSec, 0.001)
    let alpha = 1 - exp(-deltaTimeSec / tau)
    return currentDeg + shortestAngleDeltaDeg(from: currentDeg, to: targetDeg) * alpha
}
