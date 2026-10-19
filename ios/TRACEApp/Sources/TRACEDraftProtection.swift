import SwiftUI

private struct TRACEDraftProtection: ViewModifier {
    let isDirty: Bool
    let isSaving: Bool
    let dismiss: () -> Void
    @State private var confirmingDiscard = false

    func body(content: Content) -> some View {
        content
            .interactiveDismissDisabled(isDirty || isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isDirty { confirmingDiscard = true }
                        else { dismiss() }
                    }.disabled(isSaving)
                }
            }
            .alert("Discard unsaved changes?", isPresented: $confirmingDiscard) {
                Button("Discard changes", role: .destructive, action: dismiss)
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("Your changes have not been saved.")
            }
    }
}

extension View {
    func traceDraftProtection(isDirty: Bool, isSaving: Bool, dismiss: @escaping () -> Void) -> some View {
        modifier(TRACEDraftProtection(isDirty: isDirty, isSaving: isSaving, dismiss: dismiss))
    }
}
