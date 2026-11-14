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
            OmniGizmoMark(size: 56)
            Text("Omni").font(.title.weight(.semibold))
            Text("Sign in to browse and play games.")
                .foregroundStyle(OmniTheme.textSecondary)
                .multilineTextAlignment(.center)

            // Only the name is requested, and Apple sends it once, at the first authorization.
            SignInWithAppleButton(.signIn, onRequest: { $0.requestedScopes = [.fullName] }, onCompletion: handle)
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(maxWidth: 320, minHeight: 48, maxHeight: 48)
                .disabled(model.isWorking)

            if model.hasSavedSession {
                Button("Try again") { Task { await model.start() } }
                    .buttonStyle(OmniSecondaryButtonStyle())
                    .disabled(model.isWorking)
            }
            if let message = model.message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(OmniTheme.error)
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
    // Simulator and ad-hoc Mac builds cannot use Sign in with Apple; the server needs OMNI_DEV_SIGNIN=1.
    private var devSection: some View {
        VStack(spacing: 8) {
            Divider()
            Text("Debug builds only").font(.caption).foregroundStyle(OmniTheme.textSecondary)
            TextField("Dev name", text: $devName)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .frame(maxWidth: 320)
            Button("Dev sign-in") { Task { await model.signInDev(name: devName) } }
                .buttonStyle(OmniSecondaryButtonStyle())
                .disabled(model.isWorking)
        }
    }
    #endif
}
