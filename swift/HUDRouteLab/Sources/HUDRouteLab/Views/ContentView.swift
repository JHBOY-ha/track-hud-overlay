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
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    TimelinePanel(model: model)
                }
                .inspector(isPresented: $showsInspector) {
                    RouteInspectorView(model: model)
                        .inspectorColumnWidth(min: 250, ideal: 285, max: 340)
                }
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
                    model.importTrack()
                } label: {
                    Label("导入轨迹", systemImage: "square.and.arrow.down")
                }
                .keyboardShortcut("o", modifiers: [.command])

                Button {
                    model.importVideo()
                } label: {
                    Label("导入视频", systemImage: "film")
                }

                Button {
                    model.completeRoadNetwork()
                } label: {
                    Label("补全路网", systemImage: "point.3.connected.trianglepath.dotted")
                }
                .disabled(model.importedTrack == nil || model.isLoading)

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
        .background {
            TransportKeyObserver(
                onTogglePlayback: model.togglePlayback,
                onReverse: model.shuttleReverse,
                onForward: model.shuttleForward
            )
        }
    }

    private var mapEditor: some View {
        ZStack {
            RoadMapView(
                roads: model.roads,
                route: model.route.path,
                importedTrack: model.showsOriginalTrack ? model.importedCoordinates : [],
                snapPreview: model.showsSnapPreview ? model.snapPreview.points : [],
                importedCursorPoint: model.showsOriginalTrack ? model.importedCursorPoint : nil,
                snappedCursorPoint: model.showsSnapPreview ? model.snappedCursorPoint : nil,
                routeCursorPoint: model.routeCursorPoint,
                marks: model.marks,
                center: model.center,
                radiusM: model.radiusM,
                selectedMarkID: model.selectedMarkID,
                disconnectedMarkIDs: model.disconnectedMarkIDs,
                command: model.mapCommand,
                commandRevision: model.mapCommandRevision,
                contentRevision: model.mapContentRevision,
                onClick: model.clickMap
            )

            if model.roads.isEmpty && model.importedTrack == nil && !model.isLoading {
                ContentUnavailableView {
                    Label("尚未载入路网", systemImage: "map")
                } description: {
                    Text("导入 GPX / GeoJSON 轨迹，或输入中心坐标后获取 OpenStreetMap 道路。")
                } actions: {
                    HStack {
                        Button("导入轨迹") { model.importTrack() }
                            .buttonStyle(.borderedProminent)
                        Button("获取路网") { model.fetchRoads() }
                    }
                }
                .frame(maxWidth: 430)
                .padding(28)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            }

            if model.isLoading {
                ProgressView(model.statusText)
                    .padding(18)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }

            if model.importedVideo != nil, model.showsVideoPreview {
                VStack(spacing: 0) {
                    HStack {
                        Label(model.importedVideo?.name ?? "视频", systemImage: "film")
                            .lineLimit(1)
                        Spacer()
                        Button {
                            model.showsVideoPreview = false
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .buttonStyle(.plain)
                    }
                    .font(.caption)
                    .padding(8)
                    .background(.regularMaterial)

                    VideoPreviewView(player: model.videoPlayer)
                        .aspectRatio(16 / 9, contentMode: .fit)
                }
                .frame(width: 360)
                .background(.black, in: RoundedRectangle(cornerRadius: 10))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .shadow(radius: 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(16)
            }
        }
        .navigationTitle("路线编辑器")
    }
}
