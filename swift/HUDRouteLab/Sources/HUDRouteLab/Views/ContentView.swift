import SwiftUI

struct ContentView: View {
    @Bindable var model: RouteLabModel
    @State private var showsInspector = true

    var body: some View {
        NavigationSplitView {
            RouteSidebarView(model: model)
                .navigationSplitViewColumnWidth(min: 250, ideal: 285, max: 340)
        } detail: {
            mapEditor
                .inspector(isPresented: $showsInspector) {
                    RouteInspectorView(model: model)
                        .inspectorColumnWidth(min: 250, ideal: 285, max: 340)
                }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            TimelinePanel(model: model)
        }
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button {
                    model.undoMark()
                } label: {
                    Label("撤销标记", systemImage: "arrow.uturn.backward")
                }
                .disabled(model.marks.isEmpty)

                Button {
                    model.clearMarks()
                } label: {
                    Label("清空标记", systemImage: "trash")
                }
                .disabled(model.marks.isEmpty)
            }

            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    model.fetchRoads()
                } label: {
                    Label(model.isLoading ? "正在获取路网" : "获取路网", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(model.isLoading)
                .keyboardShortcut(.return, modifiers: [.command])

                Menu {
                    Button("放大") { model.sendMapCommand(.zoom(1.4)) }
                    Button("缩小") { model.sendMapCommand(.zoom(0.72)) }
                    Divider()
                    Button("复位地图") { model.resetMap() }
                } label: {
                    Label("地图显示", systemImage: "map")
                }

                Button {
                    model.export()
                } label: {
                    Label("导出 GeoJSON", systemImage: "square.and.arrow.up")
                }
                .disabled(!model.canExport)
                .keyboardShortcut("e", modifiers: [.command])

                Button {
                    showsInspector.toggle()
                } label: {
                    Label("路线检查器", systemImage: "sidebar.right")
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .exportRoute)) { _ in
            model.export()
        }
    }

    private var mapEditor: some View {
        ZStack {
            RoadMapView(
                roads: model.roads,
                route: model.route.path,
                marks: model.marks,
                center: model.center,
                radiusM: model.radiusM,
                selectedMarkID: model.selectedMarkID,
                disconnectedMarkIDs: model.disconnectedMarkIDs,
                command: model.mapCommand,
                commandRevision: model.mapCommandRevision,
                onClick: model.clickMap
            )

            if model.roads.isEmpty && !model.isLoading {
                ContentUnavailableView {
                    Label("尚未载入路网", systemImage: "map")
                } description: {
                    Text("在侧边栏输入中心坐标和半径，然后从 OpenStreetMap 获取道路。")
                } actions: {
                    Button("获取路网") { model.fetchRoads() }
                        .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: 430)
                .padding(28)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            }

            if model.isLoading {
                ProgressView("正在获取 OpenStreetMap 路网...")
                    .padding(18)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .navigationTitle("路线编辑器")
    }
}
