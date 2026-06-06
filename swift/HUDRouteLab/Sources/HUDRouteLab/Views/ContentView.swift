import SwiftUI

struct ContentView: View {
    @State private var model = RouteLabModel()

    var body: some View {
        VStack(spacing: 0) {
            controls
            Divider()
            HSplitView {
                RoadMapView(
                    roads: model.roads,
                    route: model.route.path,
                    marks: model.marks,
                    center: model.center,
                    radiusM: model.radiusM,
                    selectedMarkID: model.selectedMarkID,
                    onClick: model.clickMap
                )
                .frame(minWidth: 640, minHeight: 480)

                MarkInspectorView(model: model)
                    .frame(minWidth: 270, idealWidth: 310, maxWidth: 360)
            }
            Divider()
            timeline
        }
        .frame(minWidth: 1050, minHeight: 720)
        .onReceive(NotificationCenter.default.publisher(for: .exportRoute)) { _ in
            model.export()
        }
    }

    private var controls: some View {
        HStack(spacing: 12) {
            coordinateField("经度", value: $model.longitude)
            coordinateField("纬度", value: $model.latitude)

            HStack(spacing: 6) {
                Text("半径")
                TextField("1000", value: $model.radiusM, format: .number)
                    .frame(width: 72)
                Text("m")
                    .foregroundStyle(.secondary)
            }

            Button("获取路网") {
                model.fetchRoads()
            }
            .keyboardShortcut(.return, modifiers: [.command])
            .disabled(model.isLoading)

            if model.isLoading {
                ProgressView()
                    .controlSize(.small)
            }

            Spacer()

            Text(model.statusText)
                .foregroundStyle(model.statusIsError ? .red : .secondary)
                .lineLimit(1)

            Button("导出 GeoJSON") {
                model.export()
            }
            .keyboardShortcut("e", modifiers: [.command])
            .disabled(!model.canExport)
        }
        .padding(12)
    }

    private func coordinateField(_ title: String, value: Binding<Double>) -> some View {
        HStack(spacing: 6) {
            Text(title)
            TextField(title, value: value, format: .number.precision(.fractionLength(6)))
                .frame(width: 112)
        }
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("当前时间")
                    .font(.headline)
                Text(model.cursorTime.formatted(date: .omitted, time: .standard))
                    .monospacedDigit()
                Spacer()
                Text("设置时间后点击道路添加标记")
                    .foregroundStyle(.secondary)
            }

            Slider(value: $model.cursorSeconds, in: 0 ... 86_399, step: 0.1)

            HStack {
                Text("00:00:00")
                Spacer()
                Text("12:00:00")
                Spacer()
                Text("23:59:59")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.bar)
    }
}
