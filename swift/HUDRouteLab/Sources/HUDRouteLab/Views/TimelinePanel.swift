import SwiftUI

struct TimelinePanel: View {
    @Bindable var model: RouteLabModel
    @State private var isExpanded = true

    private var spanSeconds: Double { model.timelineHours * 3600 }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    withAnimation(.snappy) { isExpanded.toggle() }
                } label: {
                    Label("时间轴", systemImage: isExpanded ? "chevron.down" : "chevron.right")
                }
                .buttonStyle(.plain)

                Text(model.cursorTime.formatted(date: .omitted, time: .standard))
                    .font(.body.monospacedDigit())

                Button {
                    model.togglePlayback()
                } label: {
                    Label(model.isPlaying ? "暂停" : "播放", systemImage: model.isPlaying ? "pause.fill" : "play.fill")
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.space, modifiers: [])

                if model.importedTrack != nil {
                    Label("轨迹位置", systemImage: "location.fill")
                        .font(.caption)
                        .foregroundStyle(.blue)
                }

                Spacer()

                Picker("时间轴缩放", selection: Binding(
                    get: { model.timelineHours },
                    set: { model.setTimelineHours($0) }
                )) {
                    ForEach([24.0, 12.0, 6.0, 3.0, 1.0], id: \.self) { hours in
                        Text("\(Int(hours)) 小时").tag(hours)
                    }
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .frame(width: 300)

                Button {
                    model.revealCursor()
                } label: {
                    Label("定位当前时间", systemImage: "scope")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 42)

            if isExpanded {
                Divider()

                timelineTrack
                    .frame(height: 78)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)

                HStack(spacing: 10) {
                    Text(clock(model.timelineStartSeconds))
                        .font(.caption.monospacedDigit())
                        .frame(width: 62, alignment: .leading)

                    Slider(
                        value: $model.timelineStartSeconds,
                        in: 0 ... max(0.001, 86_400 - spanSeconds)
                    )
                    .disabled(model.timelineHours == 24)

                    Text(clock(model.timelineEndSeconds))
                        .font(.caption.monospacedDigit())
                        .frame(width: 62, alignment: .trailing)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
        }
        .background(.regularMaterial)
    }

    private var timelineTrack: some View {
        GeometryReader { geometry in
            let width = max(1, geometry.size.width)
            let ordered = model.orderedMarks

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(.quaternary.opacity(0.45))
                    .overlay {
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(.separator.opacity(0.7), lineWidth: 1)
                    }

                ForEach(0 ... tickCount, id: \.self) { index in
                    let fraction = Double(index) / Double(tickCount)
                    let x = width * fraction
                    let seconds = model.timelineStartSeconds + spanSeconds * fraction
                    Rectangle()
                        .fill(.separator.opacity(0.55))
                        .frame(width: 1, height: 34)
                        .offset(x: x, y: 22)
                    Text(clock(seconds, includeSeconds: false))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .offset(x: min(max(2, x - 20), width - 42), y: 3)
                }

                let cursorX = xPosition(model.cursorSeconds, width: width)
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: 2, height: 50)
                    .offset(x: cursorX, y: 12)

                if let range = model.importedTimelineRange,
                   range.upperBound >= model.timelineStartSeconds,
                   range.lowerBound <= model.timelineStartSeconds + spanSeconds {
                    let startX = xPosition(range.lowerBound, width: width)
                    let endX = xPosition(range.upperBound, width: width)
                    Capsule()
                        .fill(Color.blue.opacity(0.72))
                        .frame(width: max(3, endX - startX), height: 7)
                        .offset(x: startX, y: 48)
                    if range.contains(model.cursorSeconds) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 9, height: 9)
                            .offset(x: cursorX - 4.5, y: 47)
                    }
                }

                if let range = model.videoTimelineRange,
                   range.upperBound >= model.timelineStartSeconds,
                   range.lowerBound <= model.timelineStartSeconds + spanSeconds {
                    let startX = xPosition(range.lowerBound, width: width)
                    let endX = xPosition(range.upperBound, width: width)
                    Capsule()
                        .fill(Color.purple.opacity(0.78))
                        .frame(width: max(3, endX - startX), height: 8)
                        .overlay(alignment: .leading) {
                            Text("VIDEO")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.leading, 5)
                        }
                        .offset(x: startX, y: 61)
                }

                ForEach(Array(ordered.enumerated()), id: \.element.id) { index, mark in
                    if isVisible(model.secondsForMark(mark.id)) {
                        let x = xPosition(model.secondsForMark(mark.id), width: width)
                        VStack(spacing: 1) {
                            Text("T\(index + 1)")
                                .font(.caption2.bold())
                            Circle()
                                .fill(model.selectedMarkID == mark.id ? Color.green : Color.orange)
                                .frame(width: 10, height: 10)
                        }
                        .offset(x: x - 10, y: 30)
                        .highPriorityGesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    model.updateMarkTime(
                                        mark.id,
                                        seconds: seconds(at: value.location.x, width: width),
                                        rebuild: false
                                    )
                                }
                                .onEnded { _ in model.rebuildCurrentRoute() }
                        )
                    }
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                model.scrubTimeline(to: seconds(at: value.location.x, width: width))
            })
        }
    }

    private var tickCount: Int {
        max(2, min(12, Int(model.timelineHours)))
    }

    private func isVisible(_ seconds: Double) -> Bool {
        seconds >= model.timelineStartSeconds && seconds <= model.timelineStartSeconds + spanSeconds
    }

    private func xPosition(_ seconds: Double, width: Double) -> Double {
        min(width, max(0, (seconds - model.timelineStartSeconds) / spanSeconds * width))
    }

    private func seconds(at x: Double, width: Double) -> Double {
        min(86_399, max(0, model.timelineStartSeconds + min(1, max(0, x / width)) * spanSeconds))
    }

    private func clock(_ seconds: Double, includeSeconds: Bool = true) -> String {
        let value = max(0, min(86_399, Int(seconds.rounded())))
        let hour = value / 3600
        let minute = value % 3600 / 60
        let second = value % 60
        return includeSeconds
            ? String(format: "%02d:%02d:%02d", hour, minute, second)
            : String(format: "%02d:%02d", hour, minute)
    }
}
