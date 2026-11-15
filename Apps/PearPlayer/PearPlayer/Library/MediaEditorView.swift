import ImageIO
import PearCloud
import PearLibrary
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// One image in the editor: the item as it will be published, plus the JPEG still to upload (nil = already stored).
struct MediaDraftItem: Identifiable {
    var item: MediaItem
    var pending: Data?
    /// Decoded once at pick time so panning and zooming do not decode again.
    var preview: Image?
    var id: String { item.name }
}

/// Pure image helpers for the media editor and `PlayerModel.saveMedia`.
enum MediaImage {
    static let maxEdge = 2560
    static let coverSize = (width: 1200, height: 900)
    static let coverMaxBytes = 2 * 1024 * 1024

    typealias Outcome = (data: Data?, width: Int, height: Int, problem: String?)

    /// Checks the original's pixel size, then returns it downscaled to `maxEdge` as an upright JPEG (orientation baked in).
    nonisolated static func prepare(_ raw: Data) -> Outcome {
        guard let source = CGImageSourceCreateWithData(raw as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              var width = props[kCGImagePropertyPixelWidth] as? Int,
              var height = props[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0
        else { return (nil, 0, 0, "That photo could not be read.") }
        if let orientation = props[kCGImagePropertyOrientation] as? Int, (5...8).contains(orientation) {
            swap(&width, &height)
        }
        // The result is always re-encoded as JPEG, so any decodable type (HEIC from the camera) passes the type check;
        // the size check is on the result below, not on the original.
        if let problem = MediaRules.problem(type: "image/jpeg", size: 0, width: width, height: height) {
            return (nil, 0, 0, problem)
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: min(maxEdge, max(width, height)),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              let jpeg = encodeJPEG(image, quality: 0.85)
        else { return (nil, 0, 0, "That photo could not be read.") }
        if jpeg.count > MediaRules.maxBytes {
            return (nil, 0, 0, "Images must be \(MediaRules.maxBytes / 1024 / 1024) MB or smaller.")
        }
        return (jpeg, image.width, image.height, nil)
    }

    /// A small decoded copy for on-screen preview.
    nonisolated static func previewImage(_ data: Data) -> Image? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1280,
              ] as CFDictionary)
        else { return nil }
        return Image(decorative: cg, scale: 1)
    }

    /// The `crop` of the image, scaled to `coverSize`, as a JPEG under `coverMaxBytes`; nil when it cannot be made.
    nonisolated static func coverJPEG(from data: Data, crop: Crop) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return nil }
        let w = Double(image.width), h = Double(image.height)
        let rect = CGRect(x: crop.x * w, y: crop.y * h, width: crop.w * w, height: crop.h * h).integral
        guard let part = image.cropping(to: rect),
              let ctx = CGContext(
                data: nil, width: coverSize.width, height: coverSize.height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(part, in: CGRect(x: 0, y: 0, width: coverSize.width, height: coverSize.height))
        guard let out = ctx.makeImage() else { return nil }
        for quality in [0.85, 0.7, 0.55, 0.4] {
            if let jpeg = encodeJPEG(out, quality: quality), jpeg.count <= coverMaxBytes { return jpeg }
        }
        return nil
    }

    nonisolated static func encodeJPEG(_ image: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }
}

/// Shows only `crop` (0..1 fractions of the image) of an image, filling whatever box it is given. The box must have the
/// crop's aspect (the surface's) for the image not to stretch.
struct CroppedImage: View {
    var url: URL?
    var image: Image?
    let crop: Crop

    init(url: URL?, crop: Crop) {
        self.url = url
        self.crop = crop
    }

    init(image: Image, crop: Crop) {
        self.image = image
        self.crop = crop
    }

    var body: some View {
        GeometryReader { geo in
            let dispW = geo.size.width / crop.w
            let dispH = geo.size.height / crop.h
            content
                .frame(width: dispW, height: dispH)
                .offset(x: -crop.x * dispW, y: -crop.y * dispH)
                .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                .clipped()
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder private var content: some View {
        if let image {
            image.resizable()
        } else if let url {
            AsyncImage(url: url) { phase in
                if let loaded = phase.image { loaded.resizable() } else { Color.clear }
            }
        }
    }
}

/// Edit a game's thumbnail and carousel: pick, crop per surface, caption, save.
struct MediaEditorView: View {
    let entry: CatalogEntry
    let model: PlayerModel
    @Environment(\.dismiss) private var dismiss
    @State private var thumbnail: MediaDraftItem?
    @State private var carousel: [MediaDraftItem]
    @State private var thumbPick: PhotosPickerItem?
    @State private var carouselPicks: [PhotosPickerItem] = []
    @State private var working = false
    @State private var message: String?

    init(entry: CatalogEntry, model: PlayerModel, initial: GameMedia) {
        self.entry = entry
        self.model = model
        _thumbnail = State(initialValue: initial.thumbnail.map { MediaDraftItem(item: $0) })
        _carousel = State(initialValue: initial.carousel.map { MediaDraftItem(item: $0) })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PearTheme.Space.s6) {
                    VStack(alignment: .leading, spacing: PearTheme.Space.s1) {
                        ForEach(MediaRules.guidelines, id: \.self) { line in
                            Text("• \(line)").font(PearTheme.small).foregroundStyle(PearTheme.textSecondary)
                        }
                    }
                    section("Thumbnail")
                    if thumbnail != nil {
                        MediaImageCard(
                            draft: Binding(get: { thumbnail ?? MediaDraftItem(item: placeholder) }, set: { thumbnail = $0 }),
                            model: model, startSurface: .card, showCaption: false
                        ) { thumbnail = nil }
                    }
                    PhotosPicker(selection: $thumbPick, matching: .images) {
                        Text(thumbnail == nil ? "Choose thumbnail" : "Replace thumbnail")
                    }
                    .buttonStyle(PearSecondaryButtonStyle())
                    .disabled(working)

                    section("Carousel (\(carousel.count) of \(MediaRules.carouselMax))")
                    ForEach($carousel) { $draft in
                        MediaImageCard(draft: $draft, model: model, startSurface: .carousel, showCaption: true) {
                            carousel.removeAll { $0.id == draft.id }
                        }
                    }
                    if carousel.count < MediaRules.carouselMax {
                        PhotosPicker(
                            selection: $carouselPicks, maxSelectionCount: MediaRules.carouselMax - carousel.count,
                            matching: .images
                        ) { Text("Add carousel images") }
                            .buttonStyle(PearSecondaryButtonStyle())
                            .disabled(working)
                    }

                    if working { ProgressView() }
                    if let message {
                        Text(message).font(PearTheme.small).foregroundStyle(PearTheme.error)
                    }
                }
                .padding(PearTheme.Space.s6)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(PearTheme.bgField)
            .navigationTitle("Edit media")
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(working) }
            }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 640)
        #endif
        .onChange(of: thumbPick) { _, item in
            guard let item else { return }
            Task { await ingest([item], thumbnail: true) }
        }
        .onChange(of: carouselPicks) { _, items in
            guard !items.isEmpty else { return }
            Task { await ingest(items, thumbnail: false) }
        }
    }

    /// Only shown while `thumbnail` is non-nil; keeps the card's binding total.
    private var placeholder: MediaItem {
        MediaItem(name: "", sha256: "", size: 0, contentType: "image/jpeg", width: 1, height: 1)
    }

    private func section(_ title: String) -> some View {
        Text(title)
            .font(PearTheme.sans(17, .semibold, relativeTo: .headline))
            .foregroundStyle(PearTheme.text)
            .accessibilityAddTraits(.isHeader)
    }

    private func ingest(_ picks: [PhotosPickerItem], thumbnail isThumbnail: Bool) async {
        working = true
        message = nil
        defer {
            working = false
            thumbPick = nil
            carouselPicks = []
        }
        for (index, pick) in picks.enumerated() {
            if !isThumbnail && carousel.count >= MediaRules.carouselMax { break }
            guard let raw = try? await pick.loadTransferable(type: Data.self) else {
                message = "That photo could not be read."
                continue
            }
            let outcome = await Task.detached(priority: .userInitiated) { MediaImage.prepare(raw) }.value
            guard let data = outcome.data else {
                message = outcome.problem
                continue
            }
            let item = MediaItem(
                name: MediaItem.assetName(thumbnail: isThumbnail, index: isThumbnail ? 0 : carousel.count + index),
                sha256: String(repeating: "0", count: 64), size: data.count, contentType: "image/jpeg",
                width: outcome.width, height: outcome.height)
            let draft = MediaDraftItem(item: item, pending: data, preview: MediaImage.previewImage(data))
            if isThumbnail { thumbnail = draft } else { carousel.append(draft) }
        }
    }

    private func save() async {
        working = true
        message = nil
        message = await model.saveMedia(entry: entry, thumbnail: thumbnail, carousel: carousel)
        working = false
        if message == nil { dismiss() }
    }
}

/// One image: a surface picker, a crop box (drag to pan, pinch to zoom) with its safe area, a caption and remove.
private struct MediaImageCard: View {
    @Binding var draft: MediaDraftItem
    let model: PlayerModel
    let startSurface: MediaSurface
    let showCaption: Bool
    let onRemove: () -> Void
    @State private var surface: MediaSurface?
    @State private var dragStart: Crop?
    @State private var zoomStart: Crop?

    private var current: MediaSurface { surface ?? startSurface }
    private var crop: Crop { draft.item.crop(current) }

    var body: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s3) {
            Picker("Surface", selection: Binding(get: { current }, set: { surface = $0 })) {
                ForEach(MediaSurface.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            GeometryReader { geo in
                cropped
                    .overlay {
                        Rectangle()
                            .strokeBorder(PearTheme.paper.opacity(0.9), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                            .padding(.horizontal, geo.size.width * MediaRules.safeInset)
                            .padding(.vertical, geo.size.height * MediaRules.safeInset)
                            .allowsHitTesting(false)
                    }
                    .contentShape(Rectangle())
                    .gesture(pan(geo.size).simultaneously(with: pinch))
            }
            .aspectRatio(current.aspect, contentMode: .fit)
            .background(PearTheme.bgPanel)
            .clipShape(RoundedRectangle(cornerRadius: PearTheme.radiusControl))
            .accessibilityLabel("\(current.label) crop. Drag to move, pinch to zoom.")

            if showCaption {
                TextField("Caption", text: $draft.item.caption)
                    .textFieldStyle(.roundedBorder)
            }
            Button("Remove", role: .destructive, action: onRemove)
                .buttonStyle(PearSecondaryButtonStyle())
        }
        .padding(PearTheme.Space.s4)
        .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusWindow))
    }

    @ViewBuilder private var cropped: some View {
        if let preview = draft.preview {
            CroppedImage(image: preview, crop: crop)
        } else {
            CroppedImage(url: model.mediaAssetURL(draft.item), crop: crop)
        }
    }

    private func pan(_ box: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                let start = dragStart ?? crop
                dragStart = start
                // The image follows the finger, so the crop window moves the other way.
                draft.item.crops[current.rawValue] = start.moved(
                    dx: -Double(value.translation.width / box.width) * start.w,
                    dy: -Double(value.translation.height / box.height) * start.h)
            }
            .onEnded { _ in dragStart = nil }
    }

    private var pinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = zoomStart ?? crop
                zoomStart = start
                let item = draft.item
                let base = start.zoom(imgW: Double(item.width), imgH: Double(item.height), aspect: current.aspect)
                let target = min(MediaRules.maxZoom, max(1, base * Double(value.magnification)))
                draft.item.crops[current.rawValue] = start.zoomed(
                    imgW: Double(item.width), imgH: Double(item.height), aspect: current.aspect, to: target)
            }
            .onEnded { _ in zoomStart = nil }
    }
}
