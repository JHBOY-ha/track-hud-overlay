import Foundation

/// Speed display unit. Mirrors `SpeedUnit` in src/util/units.ts.
public enum SpeedUnit: String, Sendable, CaseIterable {
    case kmh
    case mph
}

public let kmhToMph = 0.621371

/// Port of `convertSpeed` from src/util/units.ts.
public func convertSpeed(_ kmh: Double, unit: SpeedUnit) -> Double {
    unit == .mph ? kmh * kmhToMph : kmh
}

/// Port of `speedUnitLabel` from src/util/units.ts.
public func speedUnitLabel(_ unit: SpeedUnit) -> String {
    unit == .mph ? "MPH" : "km/h"
}

/// Port of `clamp` from src/util/units.ts.
public func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    max(lo, min(hi, v))
}

/// Port of `lerp` from src/util/units.ts.
public func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double {
    a + (b - a) * t
}
