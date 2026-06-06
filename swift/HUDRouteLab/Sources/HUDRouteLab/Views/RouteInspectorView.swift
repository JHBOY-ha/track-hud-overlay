import SwiftUI

struct RouteInspectorView: View {
    @Bindable var model: RouteLabModel

    var body: some View {
        Form {
            Section("路线") {
                LabeledContent("状态") {
                    Label(
                        model.canExport ? "可导出" : "尚未完成",
                        systemImage: model.canExport ? "checkmark.circle.fill" : "exclamationmark.circle.fill"
                    )
                    .foregroundStyle(model.canExport ? .green : .orange)
                }
                LabeledContent("总距离", value: "\(model.route.lengthM.formatted(.number.precision(.fractionLength(0)))) m")
                LabeledContent("采样点", value: "\(model.route.samples.count)")
                LabeledContent("采样频率", value: "10 Hz")
            }

            if let issue = model.routeIssueText {
                Section("需要处理") {
                    Label(issue, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }

            Section("标记时间") {
                ForEach(Array(model.orderedMarks.enumerated()), id: \.element.id) { index, mark in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("T\(index + 1)")
                            Spacer()
                            Text(mark.time.formatted(date: .omitted, time: .standard))
                                .monospacedDigit()
                        }

                        Slider(
                            value: Binding(
                                get: { model.secondsForMark(mark.id) },
                                set: { model.updateMarkTime(mark.id, seconds: $0, rebuild: false) }
                            ),
                            in: 0 ... 86_399,
                            onEditingChanged: { editing in
                                if !editing { model.rebuildCurrentRoute() }
                            }
                        )
                    }
                }
            }

            Section {
                Button("导出 HUD GeoJSON") { model.export() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canExport)
            }
        }
        .formStyle(.grouped)
        .padding(.top, 8)
    }
}

