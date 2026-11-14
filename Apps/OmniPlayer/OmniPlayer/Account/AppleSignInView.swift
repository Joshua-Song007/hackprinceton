import AuthenticationServices
import SwiftUI

struct AppleSignInView: View {
    let model: PlayerModel
    #if DEBUG
    @State private var devName = ""
    #endif

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "gamecontroller.fill")
                .font(.system(size: 56))
                .accessibilityHidden(true)
            Text("Omni").font(.largeTitle.bold())
            Text("Sign in to browse and play games.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            // Only the name is requested, and Apple sends it once, at the first authorization.
            SignInWithAppleButton(.signIn, onRequest: { $0.requestedScopes = [.fullName] }, onCompletion: handle)
                .frame(maxWidth: 320, minHeight: 48, maxHeight: 48)
                .disabled(model.isWorking)

            if model.hasSavedSession {
                Button("Try again") { Task { await model.start() } }
                    .disabled(model.isWorking)
            }
            if let message = model.message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.red)
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
            model.report("Sign in with Apple failed. Try again.")
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
            Text("Debug builds only").font(.caption).foregroundStyle(.secondary)
            TextField("Dev name", text: $devName)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .frame(maxWidth: 320)
            Button("Dev sign-in") { Task { await model.signInDev(name: devName) } }
                .disabled(model.isWorking)
        }
    }
    #endif
}
