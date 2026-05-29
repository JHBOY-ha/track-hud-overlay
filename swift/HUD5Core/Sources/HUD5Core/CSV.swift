import Foundation

/// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes
/// (`""`), and CRLF/LF line endings. Replaces Papa Parse for the telemetry
/// ingestion path, which only needs header + numeric/string cells.
public enum CSV {
    /// Parse into rows of fields. Empty input yields no rows.
    public static func parseRows(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var field = ""
        var row: [String] = []
        var inQuotes = false
        var sawAnyChar = false

        let chars = Array(text)
        var i = 0
        func endField() {
            row.append(field)
            field = ""
        }
        func endRow() {
            endField()
            rows.append(row)
            row = []
        }

        while i < chars.count {
            let c = chars[i]
            sawAnyChar = true
            if inQuotes {
                if c == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" {
                        field.append("\"")
                        i += 2
                        continue
                    }
                    inQuotes = false
                    i += 1
                    continue
                }
                field.append(c)
                i += 1
                continue
            }
            switch c {
            case "\"":
                inQuotes = true
            case ",":
                endField()
            case "\r":
                // swallow; handle the row break on the following \n (or alone)
                if i + 1 < chars.count && chars[i + 1] == "\n" {
                    i += 1
                }
                endRow()
            case "\n":
                endRow()
            default:
                field.append(c)
            }
            i += 1
        }

        if sawAnyChar && (!field.isEmpty || !row.isEmpty) {
            endRow()
        }
        return rows
    }

    /// Parse into header-keyed dictionaries. Headers are trimmed and
    /// lowercased to mirror `transformHeader` in src/data/telemetry.ts.
    /// Empty lines are skipped.
    public static func parseObjects(_ text: String) -> [[String: String]] {
        let rows = parseRows(text)
        guard let header = rows.first else { return [] }
        let keys = header.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }

        var out: [[String: String]] = []
        for row in rows.dropFirst() {
            // skipEmptyLines: a row that is entirely empty.
            if row.allSatisfy({ $0.isEmpty }) { continue }
            var obj: [String: String] = [:]
            for (idx, key) in keys.enumerated() {
                obj[key] = idx < row.count ? row[idx] : ""
            }
            out.append(obj)
        }
        return out
    }
}
