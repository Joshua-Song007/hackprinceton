import ImageIO
import PearCloud
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Profile settings: picture, display name, friend code and sign out.
struct ProfileSettingsSheet: View {
    let model: PlayerModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var picked: PhotosPickerItem?
    @State private var message: String?
    @State private var working = false

    private var account: Account? {
        if case .signedIn(let account) = model.phase { return account }
        return nil
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool { !working && !trimmed.isEmpty && trimmed != account?.displayName }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PearTheme.Space.s6) {
                    picture
                    nameField
                    if !model.friendCode.isEmpty { friendCode }
                    if let message {
                        Text(message).font(PearTheme.small).foregroundStyle(PearTheme.error)
                    }
                    Button("Sign out", role: .destructive) {
                        dismiss()
                        Task { await model.signOut() }
                    }
                    .buttonStyle(PearSecondaryButtonStyle())
                }
                .padding(PearTheme.Space.s6)
                .frame(maxWidth: 520, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(PearTheme.bgField)
            .navigationTitle("Profile")
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 460)
        #endif
        .onAppear { name = account?.displayName ?? "" }
        .task { if model.friendCode.isEmpty { await model.refreshFriends() } }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private var picture: some View {
        HStack(spacing: PearTheme.Space.s6) {
            AvatarView(name: account?.displayName ?? "", size: 96, accountId: account?.id)
            VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
                PhotosPicker(selection: $picked, matching: .images) { Text("Choose photo") }
                    .buttonStyle(PearPrimaryButtonStyle())
                    .disabled(working)
                Button("Remove photo") {
                    Task { await run { await model.removeAvatar() } }
                }
                .buttonStyle(PearSecondaryButtonStyle())
                .disabled(working)
            }
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
            Text("Display name")
                .font(PearTheme.sans(17, .semibold, relativeTo: .headline))
                .foregroundStyle(PearTheme.text)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: PearTheme.Space.s3) {
                TextField("Display name", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await saveName() } }
                Button("Save") { Task { await saveName() } }
                    .buttonStyle(PearPrimaryButtonStyle())
                    .disabled(!canSave)
            }
        }
    }

    private var friendCode: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s2) {
            Text("Your friend code")
                .font(PearTheme.sans(17, .semibold, relativeTo: .headline))
                .foregroundStyle(PearTheme.text)
                .accessibilityAddTraits(.isHeader)
            HStack {
                Text(model.friendCode)
                    .font(PearTheme.mono(22))
                    .tracking(2)
                    .foregroundStyle(PearTheme.text)
                    .textSelection(.enabled)
                Spacer()
                ShareLink(item: model.friendCode) { Label("Share", systemImage: "square.and.arrow.up") }
                    .buttonStyle(PearSecondaryButtonStyle())
            }
        }
    }

    /// Runs one profile change; the model returns text when it failed.
    private func run(_ change: () async -> String?) async {
        working = true
        message = await change()
        working = false
    }

    private func saveName() async {
        guard canSave else { return }
        await run { await model.updateDisplayName(trimmed) }
    }

    private func upload(_ item: PhotosPickerItem) async {
        defer { picked = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self),
              let jpeg = Self.squareJPEG(from: raw)
        else {
            message = "That photo could not be read."
            return
        }
        await run { await model.setAvatar(jpeg) }
    }

    /// Center-crops to a square and scales to `side` pixels, as JPEG; nil when the data is not an image.
    /// The result is a few tens of KB, far under the server's 512 KB cap.
    nonisolated static func squareJPEG(from data: Data, side: Int = 256) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? Int,
              let height = props[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0
        else { return nil }
        let longest = Int((Double(max(width, height)) * Double(side) / Double(min(width, height))).rounded(.up))
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: longest,
        ]
        guard let thumb = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let edge = min(thumb.width, thumb.height)
        let crop = CGRect(x: (thumb.width - edge) / 2, y: (thumb.height - edge) / 2, width: edge, height: edge)
        guard let square = thumb.cropping(to: crop) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, square, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }
}
