import SwiftUI

struct NativePlacesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = NativeConversationsModel()
    private struct Place: Identifiable {
        let id: String
        let pin: ConversationPin
        var conversations: [NativeConversation]
    }
    private var places: [Place] {
        var groups: [Place] = []
        for conversation in model.conversations {
            guard let pin = conversation.geolocation, pin.valid else { continue }
            if let index = groups.firstIndex(where: { $0.pin.distance(to: pin) <= 100 }) {
                groups[index].conversations.append(conversation)
            } else { groups.append(Place(id: conversation.id, pin: pin, conversations: [conversation])) }
        }
        return groups
    }
    var body: some View {
        NavigationStack {
            List {
                if let error = model.error { Text(error).foregroundStyle(.red) }
                if model.isLoading { ProgressView("Loading places…") }
                if places.isEmpty && !model.isLoading {
                    ContentUnavailableView("No conversation places yet", systemImage: "mappin.and.ellipse", description: Text("Enable locations in Capture or add a location to a saved conversation."))
                }
                ForEach(places) { place in
                    NavigationLink {
                        List {
                            Section { LeafletMap(pin: .constant(place.pin)).frame(height: 240) }
                            Section("Conversations") {
                                ForEach(place.conversations) { c in
                                    NavigationLink(destination: NativeConversationDetailView(id: c.id)) {
                                        VStack(alignment: .leading) {
                                            Text(c.displayTitle)
                                            if let date = c.displayDate { Text(date.formatted()).font(.caption).foregroundStyle(.secondary) }
                                        }
                                    }.accessibilityIdentifier("trace.place.conversation.\(c.id)")
                                }
                            }
                        }.navigationTitle(place.pin.label)
                    } label: {
                        VStack(alignment: .leading) {
                            Label(place.pin.label, systemImage: "mappin")
                            Text("\(place.conversations.count) conversations").font(.caption).foregroundStyle(.secondary)
                        }
                    }.accessibilityIdentifier("trace.place.\(place.id)")
                }
            }
            .navigationTitle("Places")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await reload() }
            .refreshable { await reload() }
            .onReceive(NotificationCenter.default.publisher(for: .traceConversationUpdated)) { _ in Task { await reload() } }
        }
    }
    private func reload() async {
        await model.load(refresh: true)
        while model.error == nil {
            let count = model.conversations.count
            await model.load()
            if count == model.conversations.count { break }
        }
    }
}
