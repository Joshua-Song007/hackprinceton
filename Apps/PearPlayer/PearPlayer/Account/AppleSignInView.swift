import AuthenticationServices
import SwiftUI

struct AppleSignInView: View {
    let model: PlayerModel
    @Environment(\.colorScheme) private var colorScheme
    #if DEBUG
    @State private var devName = ""
    #endif

    var body: some View {
        VStack(spacing: 20) {
            Image("PearMark").resizable().scaledToFit().frame(width: 88, height: 88).accessibilityHidden(true)
            VStack(spacing: PearTheme.Space.s2) {
                Text("Pear").font(PearTheme.display(67)).tracking(-0.6)
                Text("Everything you carry is a controller.")
                    .font(PearTheme.sans(21, relativeTo: .title3))
                    .foregroundStyle(PearTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.bottom, PearTheme.Space.s4)

            // Only the name is requested, and Apple sends it once, at the first authorization.
            SignInWithAppleButton(.signIn, onRequest: { $0.requestedScopes = [.fullName] }, onCompletion: handle)
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(maxWidth: 320, minHeight: 48, maxHeight: 48)
                .disabled(model.isWorking)

            if model.hasSavedSession {
                Button("Try again") { Task { await model.start() } }
                    .buttonStyle(PearSecondaryButtonStyle())
                    .disabled(model.isWorking)
            }
            if let message = model.message {
                Text(message)
                    .font(PearTheme.sans(16))
                    .foregroundStyle(PearTheme.error)
                    .multilineTextAlignment(.center)
            }
            #if DEBUG
            devSection
            #endif
        }
        .padding(24)
        .frame(maxWidth: 420)
    }

    private func handle(_ result: Result<ASAuthorization, any Error>) {
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            model.report("Sign in with Apple failed (code \((error as NSError).code)). Try again.")
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8)
            else {
                model.report("Apple did not return an identity token.")
                return
            }
            var name: String?
            if let components = credential.fullName {
                let formatted = PersonNameComponentsFormatter().string(from: components)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !formatted.isEmpty { name = formatted }
            }
            Task { await model.signInWithApple(identityToken: token, displayName: name) }
        }
    }

    #if DEBUG
    // Simulator and ad-hoc Mac builds cannot use Sign in with Apple; the server needs PEAR_DEV_SIGNIN=1.
    private var devSection: some View {
        VStack(spacing: 8) {
            Divider()
            Text("Debug builds only").font(.caption).foregroundStyle(PearTheme.textSecondary)
            TextField("Dev name", text: $devName)
                .textFieldStyle(.plain)
                .font(PearTheme.sans(16))
                .autocorrectionDisabled()
                .padding(.horizontal, PearTheme.Space.s3)
                .frame(maxWidth: 320, minHeight: PearTheme.controlHeight)
                .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusTag).strokeBorder(PearTheme.lineControl))
            Button("Dev sign-in") { Task { await model.signInDev(name: devName) } }
                .buttonStyle(PearSecondaryButtonStyle())
                .disabled(model.isWorking)
        }
        // Screenshots and demos: `PEAR_DEV_NAME=Maya` signs in on launch without typing.
        .task {
            if let name = ProcessInfo.processInfo.environment["PEAR_DEV_NAME"], !name.isEmpty { await model.signInDev(name: name) }
        }
    }
    #endif
}
