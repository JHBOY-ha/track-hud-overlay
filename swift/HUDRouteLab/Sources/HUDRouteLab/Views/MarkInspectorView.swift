import SwiftUI

struct MarkInspectorView: View {
    @Bindable var model: RouteLabModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("时间标记")
                    .font(.headline)
                Spacer()
                Text("\(model.marks.count)")
                    .foregroundStyle(.secondary)
            }
            .padding(12)

            Divider()

            if model.marks.isEmpty {
                ContentUnavailableView(
                    "还没有标记",
                    systemImage: "mappin.and.ellipse",
                    description: Text("在时间轴选择时间，然后点击道路")
                )
            } else {
                List {
                    ForEach(model.marks) { mark in
                        markRow(mark)
                    }
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                Label(
                    model.canExport ? "路线已连通" : "路线未完成",
                    systemImage: model.canExport ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
                )
                .foregroundStyle(model.canExport ? .green : .orange)

                Text("距离 \(model.route.lengthM.formatted(.number.precision(.fractionLength(0)))) m · 采样点 \(model.route.samples.count)")
                    .foregroundStyle(.secondary)
            }
            .padding(12)
        }
        .background(.background)
    }

    private func markRow(_ mark: RouteMark) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(mark.time.formatted(date: .omitted, time: .standard))
                    .font(.body.monospacedDigit())
                Spacer()
                Button(role: .destructive) {
                    model.deleteMark(mark.id)
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)

                Button {
                    model.selectMarkForRelocation(mark.id)
                } label: {
                    Image(systemName: model.selectedMarkID == mark.id ? "mappin.circle.fill" : "mappin.circle")
                }
                .buttonStyle(.borderless)
                .help("重新指定道路位置")
            }

            Slider(
                value: Binding(
                    get: { model.secondsForMark(mark.id) },
                    set: { model.updateMarkTime(mark.id, seconds: $0) }
                ),
                in: 0 ... 86_399,
                step: 0.1
            )

            Text("\(mark.point.lat, specifier: "%.6f"), \(mark.point.lon, specifier: "%.6f")")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }
}
