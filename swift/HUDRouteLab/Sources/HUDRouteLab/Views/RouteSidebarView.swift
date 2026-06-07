import SwiftUI

struct RouteSidebarView: View {
    @Bindable var model: RouteLabModel

    var body: some View {
        List {
            Section("视频预览") {
                if let video = model.importedVideo {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(video.name).lineLimit(1)
                            Text(video.embeddedTimecode == nil ? "无内置 timecode" : "已读取内置 tmcd timecode")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "film").foregroundStyle(.purple)
                    }
                    Toggle("显示视频预览", isOn: $model.showsVideoPreview)
                    Button("移除视频", role: .destructive) { model.clearImportedVideo() }
                } else {
                    Button {
                        model.importVideo()
                    } label: {
                        Label("导入 MOV / MP4", systemImage: "film")
                    }
                }
            }

            Section("导入轨迹") {
                if let track = model.importedTrack {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(track.name)
                                .lineLimit(1)
                            Text("\(track.points.count) 个轨迹点")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                            .foregroundStyle(.blue)
                    }

                    Button {
                        model.completeRoadNetwork()
                    } label: {
                        Label(model.isLoading ? "正在补全..." : "补全轨迹周边路网", systemImage: "point.3.connected.trianglepath.dotted")
                    }
                    .disabled(model.isLoading)

                    Button("移除导入轨迹", role: .destructive) {
                        model.clearImportedTrack()
                    }
                } else {
                    Text("导入 GPX 或 GeoJSON 后，可补全周边路网并对比吸附效果。")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Button {
                        model.importTrack()
                    } label: {
                        Label("导入 GPX / GeoJSON", systemImage: "square.and.arrow.down")
                    }
                }
            }

            Section("路网范围") {
                LabeledContent("纬度") {
                    TextField("纬度", value: $model.latitude, format: .number.precision(.fractionLength(6)))
                        .multilineTextAlignment(.trailing)
                        .frame(width: 120)
                }
                LabeledContent("经度") {
                    TextField("经度", value: $model.longitude, format: .number.precision(.fractionLength(6)))
                        .multilineTextAlignment(.trailing)
                        .frame(width: 120)
                }
                LabeledContent("半径") {
                    HStack(spacing: 4) {
                        TextField("半径", value: $model.radiusM, format: .number)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 72)
                        Text("m").foregroundStyle(.secondary)
                    }
                }

                Button {
                    model.fetchRoads()
                } label: {
                    Label(model.isLoading ? "正在获取..." : "获取周边路网", systemImage: "location.magnifyingglass")
                }
                .disabled(model.isLoading)
            }

            Section("状态") {
                Label {
                    Text(model.statusText)
                        .font(.caption)
                        .foregroundStyle(model.statusIsError ? .red : .secondary)
                } icon: {
                    Image(systemName: model.statusIsError ? "exclamationmark.triangle" : "info.circle")
                        .foregroundStyle(model.statusIsError ? .red : .secondary)
                }

                LabeledContent("道路", value: "\(model.roads.count)")
                LabeledContent("时间标记", value: "\(model.marks.count)")
                if model.importedTrack != nil {
                    LabeledContent("已吸附轨迹点", value: "\(model.snapPreview.snappedCount) / \(model.importedCoordinates.count)")
                }
            }

            Section("时间标记") {
                if model.orderedMarks.isEmpty {
                    Text("在时间轴选择时间，然后点击地图中的道路。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(model.orderedMarks.enumerated()), id: \.element.id) { index, mark in
                        markRow(index: index, mark: mark)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("HUD Route Lab")
    }

    private func markRow(index: Int, mark: RouteMark) -> some View {
        Button {
            model.selectMarkForRelocation(mark.id)
        } label: {
            HStack(spacing: 9) {
                Image(systemName: model.disconnectedMarkIDs.contains(mark.id) ? "exclamationmark.circle.fill" : "mappin.circle.fill")
                    .foregroundStyle(markColor(mark))

                VStack(alignment: .leading, spacing: 2) {
                    Text("T\(index + 1)  \(mark.time.formatted(date: .omitted, time: .standard))")
                        .fontWeight(.medium)
                    Text("\(mark.point.lat, specifier: "%.5f"), \(mark.point.lon, specifier: "%.5f")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .contentShape(Rectangle())
            .padding(.vertical, 3)
            .padding(.horizontal, 5)
            .background(
                model.selectedMarkID == mark.id ? Color.accentColor.opacity(0.16) : Color.clear,
                in: RoundedRectangle(cornerRadius: 6)
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("重新指定道路位置") { model.selectMarkForRelocation(mark.id) }
            Button("删除", role: .destructive) { model.deleteMark(mark.id) }
        }
    }

    private func markColor(_ mark: RouteMark) -> Color {
        if model.disconnectedMarkIDs.contains(mark.id) { return .red }
        if model.selectedMarkID == mark.id { return .green }
        return .orange
    }
}
