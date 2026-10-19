import Foundation
import Observation
import SwiftUI

struct NativePersonFact: Decodable, Identifiable {
    let text: String
    let conversationId: String
    let date: String
    var id: String { "\(conversationId)-\(date)-\(text)" }
}

struct NativePersonMeeting: Decodable, Identifiable {
    let conversationId: String
    let date: String
    let placeName: String?
    let lat: Double?
    let lng: Double?
    var id: String { conversationId }
}

struct NativeRelationship: Decodable, Identifiable {
    let id: String
    let aId: String
    let bId: String
    let type: String
    let aRole: String?
    let bRole: String?
    let note: String?
}

struct NativePlace: Decodable, Identifiable {
    let id: String
    let name: String
    let lat: Double
    let lng: Double
    let notes: String
}

struct NativeMeetingLocation: Decodable, Identifiable {
    let conversationId: String
    let lat: Double?
    let lng: Double?
    let placeId: String?
    let placeName: String?
    var id: String { conversationId }
}

struct NativePerson: Decodable, Identifiable {
    let id: String
    let name: String
    let aliases: [String]
    let role: String?
    let notes: String
    let facts: [NativePersonFact]
    let meetings: [NativePersonMeeting]

    enum CodingKeys: String, CodingKey { case id, name, aliases, role, notes, facts, meetings }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        aliases = try values.decodeIfPresent([String].self, forKey: .aliases) ?? []
        role = try values.decodeIfPresent(String.self, forKey: .role)
        notes = try values.decodeIfPresent(String.self, forKey: .notes) ?? ""
        facts = try values.decodeIfPresent([NativePersonFact].self, forKey: .facts) ?? []
        meetings = try values.decodeIfPresent([NativePersonMeeting].self, forKey: .meetings) ?? []
    }
}

private struct NativePeopleEnvelope: Decodable {
    let people: [NativePerson]
    let relationships: [NativeRelationship]
    let places: [NativePlace]
    let meetingLocations: [NativeMeetingLocation]

    enum CodingKeys: String, CodingKey { case people, relationships, places, meetingLocations }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        people = try values.decodeIfPresent([NativePerson].self, forKey: .people) ?? []
        relationships = try values.decodeIfPresent([NativeRelationship].self, forKey: .relationships) ?? []
        places = try values.decodeIfPresent([NativePlace].self, forKey: .places) ?? []
        meetingLocations = try values.decodeIfPresent([NativeMeetingLocation].self, forKey: .meetingLocations) ?? []
    }
}

@MainActor
@Observable
final class NativePeopleModel {
    var people: [NativePerson] = []
    var relationships: [NativeRelationship] = []
    var places: [NativePlace] = []
    var meetingLocations: [NativeMeetingLocation] = []
    var isLoading = false
    var error: String?
    private var requestGeneration = UUID()

    func load() async {
        guard !isLoading else { return }
        let generation = UUID(); requestGeneration = generation
        isLoading = true
        defer { if requestGeneration == generation { isLoading = false } }
        do {
            let data = try await NativeConnection.shared.authenticatedData(path: "/api/native/v1/people")
            guard requestGeneration == generation, !Task.isCancelled else { return }
            apply(try JSONDecoder().decode(NativePeopleEnvelope.self, from: data))
            error = nil
        } catch { if requestGeneration == generation, !Task.isCancelled { self.error = error.localizedDescription } }
    }

    func mutate(_ payload: [String: Any]) async throws {
        requestGeneration = UUID(); isLoading = false
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/people", method: "POST", body: body)
        apply(try JSONDecoder().decode(NativePeopleEnvelope.self, from: data))
        error = nil
    }

    private func apply(_ envelope: NativePeopleEnvelope) {
        people = envelope.people
        relationships = envelope.relationships
        places = envelope.places
        meetingLocations = envelope.meetingLocations
    }
}

struct NativePeopleView: View {
    @State private var model = NativePeopleModel()
    @State private var connection = NativeConnection.shared
    @State private var showingCreate = false
    @State private var search = ""
    @State private var showingSettings = false

    private var filtered: [NativePerson] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return model.people }
        return model.people.filter {
            $0.name.localizedCaseInsensitiveContains(query) || $0.aliases.contains { $0.localizedCaseInsensitiveContains(query) } || ($0.role?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if !connection.enrolled {
                    ContentUnavailableView("Connect TRACE", systemImage: "lock.shield", description: Text("Enroll this iPhone in Settings to load People."))
                } else if model.isLoading && model.people.isEmpty {
                    ProgressView("Loading People…")
                } else if model.people.isEmpty && model.error == nil {
                    ContentUnavailableView("No people yet", systemImage: "person.2", description: Text("People already saved in TRACE will appear here. You can also add someone by hand."))
                } else {
                    List {
                        if filtered.isEmpty && !search.isEmpty { ContentUnavailableView.search(text: search).listRowBackground(Color.clear) }
                        if let error = model.error { Text(error).foregroundStyle(.red) }
                        ForEach(filtered) { person in
                            NavigationLink(value: person.id) {
                                HStack(spacing: 14) {
                                    Text(person.name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined())
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(TRACEStyle.accent)
                                        .frame(width: 44, height: 44)
                                        .background(TRACEStyle.accent.opacity(0.1), in: Circle())
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(person.name).font(.headline)
                                        if let role = person.role, !role.isEmpty { Text(role).font(.subheadline).foregroundStyle(.secondary) }
                                        Text("\(person.facts.count) facts · \(person.meetings.count) meetings")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }.padding(.vertical, 6)
                            }
                        }
                    }
                    .searchable(text: $search, prompt: "Name, alias, or role")
                    .refreshable { await model.load() }
                    .navigationDestination(for: String.self) { id in
                        if let person = model.people.first(where: { $0.id == id }) {
                            NativePersonDetailView(person: person, people: model.people, relationships: model.relationships, places: model.places, meetingLocations: model.meetingLocations, model: model) { Task { await model.load() } }
                        }
                    }
                }
            }
            .traceWorkspace()
            .navigationTitle("People")
            .sheet(isPresented: $showingSettings) { NativeSettingsView() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape").accessibilityLabel("Settings") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { NativeNamedPlacesView(model: model) } label: { Label("Named places", systemImage: "mappin.and.ellipse") }
                        .disabled(!connection.enrolled)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingCreate = true } label: { Image(systemName: "plus").accessibilityLabel("Add person") }
                        .disabled(!connection.enrolled)
                }
            }
            .task { await model.load() }
            .sheet(isPresented: $showingCreate) {
                NativePersonEditor(title: "New person", onSave: { payload in
                    try await model.mutate(["action": "create"].merging(payload) { _, new in new })
                    showingCreate = false
                })
            }
        }
    }
}

private struct NativePersonDetailView: View {
    let person: NativePerson
    let people: [NativePerson]
    let relationships: [NativeRelationship]
    let places: [NativePlace]
    let meetingLocations: [NativeMeetingLocation]
    let model: NativePeopleModel
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showingEdit = false
    @State private var isDeleting = false
    @State private var error: String?
    @State private var showingRelationship = false
    @State private var locationMeeting: NativePersonMeeting?
    @State private var relationshipToDelete: NativeRelationship?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            if !person.aliases.isEmpty { Section("Also known as") { Text(person.aliases.joined(separator: ", ")) } }
            if !person.notes.isEmpty { Section("Notes") { Text(person.notes).textSelection(.enabled) } }
            Section("Voice reference") {
                NavigationLink { NativeVoiceEnrollmentView(personId: person.id) } label: { Label("Record a reference voice", systemImage: "mic") }
            }
            Section("Facts · \(person.facts.count)") {
                if person.facts.isEmpty { Text("No facts saved.").foregroundStyle(.secondary) }
                ForEach(person.facts) { fact in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(fact.text).textSelection(.enabled)
                        Text(fact.date).font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 3)
                }
            }
            Section("Meetings · \(person.meetings.count)") {
                if person.meetings.isEmpty { Text("No meetings saved.").foregroundStyle(.secondary) }
                ForEach(person.meetings) { meeting in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(meeting.placeName ?? "Conversation")
                        Text(meeting.date).font(.caption).foregroundStyle(.secondary)
                        Button { locationMeeting = meeting } label: { Text("Correct location").frame(minHeight: 44) }
                            .font(.caption)
                    }.padding(.vertical, 3)
                }
            }
            Section("Relationships") {
                ForEach(relationships.filter { $0.aId == person.id || $0.bId == person.id }) { relationship in
                    let otherID = relationship.aId == person.id ? relationship.bId : relationship.aId
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(people.first(where: { $0.id == otherID })?.name ?? "Unknown person")
                            Text(relationship.type.capitalized + (relationship.note.map { " · \($0)" } ?? ""))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            relationshipToDelete = relationship
                        } label: {
                            Image(systemName: "trash").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                        }.accessibilityLabel("Delete relationship with \(people.first(where: { $0.id == otherID })?.name ?? "this person")")
                    }
                }
                Button { showingRelationship = true } label: { Label("Add relationship", systemImage: "plus") }
                    .disabled(people.count < 2)
            }
            Section {
                Button("Delete person", role: .destructive) { isDeleting = true }
            }
        }
        .navigationTitle(person.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Edit") { showingEdit = true } } }
        .sheet(isPresented: $showingEdit) {
            NativePersonEditor(title: "Edit person", person: person) { payload in
                var request = payload
                request["action"] = "update"
                request["id"] = person.id
                _ = try await NativeConnection.shared.authenticatedRequest(
                    path: "/api/native/v1/people", method: "POST", body: JSONSerialization.data(withJSONObject: request)
                )
                showingEdit = false
                onChanged()
                dismiss()
            }
        }
        .sheet(isPresented: $showingRelationship) {
            NativeRelationshipEditor(person: person, people: people) { payload in
                try await update(payload)
                showingRelationship = false
            }
        }
        .sheet(item: $locationMeeting) { meeting in
            NativeMeetingLocationEditor(
                meeting: meeting,
                places: places,
                current: meetingLocations.first(where: { $0.conversationId == meeting.conversationId })
            ) { payload in
                try await update(payload)
                locationMeeting = nil
            }
        }
        .confirmationDialog("Delete this relationship?", isPresented: Binding(get: { relationshipToDelete != nil }, set: { if !$0 { relationshipToDelete = nil } }), titleVisibility: .visible) {
            Button("Delete relationship", role: .destructive) {
                guard let relationship = relationshipToDelete else { return }
                relationshipToDelete = nil
                Task {
                    do { try await update(["action": "delete-relationship", "id": relationship.id]) }
                    catch { self.error = error.localizedDescription }
                }
            }
            Button("Cancel", role: .cancel) { relationshipToDelete = nil }
        } message: { Text("The link between these people will be removed. Their profiles and meeting history will remain.") }
        .confirmationDialog("Delete \(person.name)?", isPresented: $isDeleting, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    do {
                        try await update(["action": "delete", "id": person.id])
                        onChanged()
                        dismiss()
                    } catch { self.error = error.localizedDescription }
                }
            }
        } message: { Text("Relationships connected to this person will also be removed.") }
    }

    private func update(_ payload: [String: Any]) async throws {
        try await model.mutate(payload)
        onChanged()
    }
}

private struct NativePersonEditor: View {
    let title: String
    var person: NativePerson?
    let onSave: ([String: Any]) async throws -> Void
    private let initialDraft: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var role: String
    @State private var aliases: String
    @State private var notes: String
    @State private var isSaving = false
    @State private var error: String?

    init(title: String, person: NativePerson? = nil, onSave: @escaping ([String: Any]) async throws -> Void) {
        self.title = title
        self.person = person
        self.onSave = onSave
        initialDraft = [person?.name ?? "", person?.role ?? "", person?.aliases.joined(separator: ", ") ?? "", person?.notes ?? ""]
        _name = State(initialValue: person?.name ?? "")
        _role = State(initialValue: person?.role ?? "")
        _aliases = State(initialValue: person?.aliases.joined(separator: ", ") ?? "")
        _notes = State(initialValue: person?.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.red) }
                TextField("Name", text: $name)
                TextField("Role", text: $role)
                TextField("Aliases, separated by commas", text: $aliases, axis: .vertical).lineLimit(1...3)
                Section("Notes") { TextEditor(text: $notes).accessibilityLabel("Notes").frame(minHeight: 140) }
            }
            .traceDraftProtection(isDirty: [name, role, aliases, notes] != initialDraft, isSaving: isSaving) { dismiss() }
            .traceWorkspace()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task {
                            isSaving = true
                            defer { isSaving = false }
                            let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !cleanName.isEmpty else { error = "A name is required."; return }
                            do {
                                try await onSave([
                                    "name": cleanName,
                                    "role": role,
                                    "aliases": aliases.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty },
                                    "notes": notes,
                                ])
                                if person != nil { dismiss() }
                            } catch { self.error = error.localizedDescription }
                        }
                    }.disabled(isSaving)
                }
            }
        }
    }
}

private struct NativeRelationshipEditor: View {
    let person: NativePerson
    let people: [NativePerson]
    let onSave: ([String: Any]) async throws -> Void
    private let initialDraft: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var selectedID: String
    @State private var type = "kin"
    @State private var role = ""
    @State private var note = ""
    @State private var error: String?
    @State private var saving = false

    init(person: NativePerson, people: [NativePerson], onSave: @escaping ([String: Any]) async throws -> Void) {
        self.person = person
        self.people = people.filter { $0.id != person.id }
        self.onSave = onSave
        initialDraft = [people.first(where: { $0.id != person.id })?.id ?? "", "kin", "", ""]
        _selectedID = State(initialValue: people.first(where: { $0.id != person.id })?.id ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.red) }
                Picker("Person", selection: $selectedID) {
                    ForEach(people) { Text($0.name).tag($0.id) }
                }
                Picker("Relationship", selection: $type) {
                    ForEach(["kin", "work", "neighbor", "introduced", "other"], id: \.self) { Text($0.capitalized).tag($0) }
                }
                TextField("Their role", text: $role)
                TextField("Note", text: $note, axis: .vertical).lineLimit(2...5)
            }
            .traceDraftProtection(isDirty: [selectedID, type, role, note] != initialDraft, isSaving: saving) { dismiss() }
            .traceWorkspace()
            .navigationTitle("Add relationship")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        Task {
                            saving = true
                            defer { saving = false }
                            do {
                                try await onSave(["action": "save-relationship", "aId": person.id, "bId": selectedID, "type": type, "aRole": role, "note": note])
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving || selectedID.isEmpty)
                }
            }
        }
    }
}

private struct NativeMeetingLocationEditor: View {
    let meeting: NativePersonMeeting
    let places: [NativePlace]
    let current: NativeMeetingLocation?
    let onSave: ([String: Any]) async throws -> Void
    private let initialDraft: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPlace: String
    @State private var placeName: String
    @State private var latitude: String
    @State private var longitude: String
    @State private var saving = false
    @State private var error: String?

    init(meeting: NativePersonMeeting, places: [NativePlace], current: NativeMeetingLocation?, onSave: @escaping ([String: Any]) async throws -> Void) {
        self.meeting = meeting
        self.places = places
        self.current = current
        self.onSave = onSave
        initialDraft = [current?.placeId ?? "", current?.placeName ?? meeting.placeName ?? "", current?.lat.map { String($0) } ?? meeting.lat.map { String($0) } ?? "", current?.lng.map { String($0) } ?? meeting.lng.map { String($0) } ?? ""]
        _selectedPlace = State(initialValue: current?.placeId ?? "")
        _placeName = State(initialValue: current?.placeName ?? meeting.placeName ?? "")
        _latitude = State(initialValue: current?.lat.map { String($0) } ?? meeting.lat.map { String($0) } ?? "")
        _longitude = State(initialValue: current?.lng.map { String($0) } ?? meeting.lng.map { String($0) } ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.red) }
                Picker("Saved place", selection: $selectedPlace) {
                    Text("No saved place").tag("")
                    ForEach(places) { Text($0.name).tag($0.id) }
                }
                TextField("Location label", text: $placeName)
                TextField("Latitude", text: $latitude).keyboardType(.numbersAndPunctuation)
                TextField("Longitude", text: $longitude).keyboardType(.numbersAndPunctuation)
                Text("Latitude: −90 to 90. Longitude: −180 to 180. Use decimal degrees, for example 7.0731, 125.6128.").font(.footnote).foregroundStyle(.secondary)
                Button("Use saved place coordinates") {
                    guard let place = places.first(where: { $0.id == selectedPlace }) else { return }
                    latitude = String(place.lat)
                    longitude = String(place.lng)
                    placeName = place.name
                }.disabled(selectedPlace.isEmpty)
            }
            .traceDraftProtection(isDirty: [selectedPlace, placeName, latitude, longitude] != initialDraft, isSaving: saving) { dismiss() }
            .traceWorkspace()
            .navigationTitle("Meeting location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        Task {
                            saving = true
                            defer { saving = false }
                            var payload: [String: Any] = ["action": "save-meeting-location", "conversationId": meeting.conversationId, "placeName": placeName]
                            payload["placeId"] = selectedPlace.isEmpty ? NSNull() : selectedPlace as Any
                            if latitude.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && longitude.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { payload["lat"] = NSNull(); payload["lng"] = NSNull() }
                            else if let lat = Double(latitude), let lng = Double(longitude), lat.isFinite, lng.isFinite, (-90...90).contains(lat), (-180...180).contains(lng) { payload["lat"] = lat; payload["lng"] = lng }
                            else { error = "Enter both coordinates in the ranges shown, or leave both empty."; return }
                            do { try await onSave(payload); dismiss() }
                            catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving)
                }
            }
        }
    }
}

private struct NativeNamedPlacesView: View {
    let model: NativePeopleModel
    @State private var adding = false
    @State private var editing: NativePlace?
    @State private var deleting: NativePlace?
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            if model.places.isEmpty {
                ContentUnavailableView("No saved places", systemImage: "mappin.and.ellipse", description: Text("Add a named place to link meeting history."))
            }
            ForEach(model.places) { place in
                Button { editing = place } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(place.name).font(.headline).foregroundStyle(.primary)
                        Text("\(place.lat.formatted(.number.precision(.fractionLength(4)))), \(place.lng.formatted(.number.precision(.fractionLength(4))))")
                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        if !place.notes.isEmpty { Text(place.notes).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    }.padding(.vertical, 3)
                }
                .swipeActions {
                    Button("Delete", role: .destructive) { deleting = place }
                }
            }
        }
        .navigationTitle("Places")
        .navigationBarTitleDisplayMode(.inline)
        .traceWorkspace()
        .alert("Delete saved place?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete place", role: .destructive) { if let place = deleting { Task { await delete(place) } }; deleting = nil }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: { Text("Remove \(deleting?.name ?? "this place") from saved places? Meeting links to this saved place are removed. Conversation and meeting history remain.") }

        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { adding = true } label: { Image(systemName: "plus").accessibilityLabel("Add place") } } }
        .sheet(isPresented: $adding) {
            NativePlaceEditor(title: "New place") { payload in
                try await save(payload)
                adding = false
            }
        }
        .sheet(item: $editing) { place in
            NativePlaceEditor(title: "Edit place", place: place) { payload in
                try await save(payload, id: place.id)
                editing = nil
            }
        }
    }

    private func save(_ payload: [String: Any], id: String? = nil) async throws {
        var request = payload
        request["action"] = "save-place"
        if let id { request["id"] = id }
        try await model.mutate(request)
    }

    private func delete(_ place: NativePlace) async {
        do { try await model.mutate(["action": "delete-place", "id": place.id]) }
        catch { self.error = error.localizedDescription }
    }
}

private struct NativePlaceEditor: View {
    let title: String
    var place: NativePlace?
    let onSave: ([String: Any]) async throws -> Void
    private let initialDraft: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var latitude: String
    @State private var longitude: String
    @State private var notes: String
    @State private var error: String?
    @State private var saving = false

    init(title: String, place: NativePlace? = nil, onSave: @escaping ([String: Any]) async throws -> Void) {
        self.title = title
        self.place = place
        self.onSave = onSave
        initialDraft = [place?.name ?? "", place.map { String($0.lat) } ?? "", place.map { String($0.lng) } ?? "", place?.notes ?? ""]
        _name = State(initialValue: place?.name ?? "")
        _latitude = State(initialValue: place.map { String($0.lat) } ?? "")
        _longitude = State(initialValue: place.map { String($0.lng) } ?? "")
        _notes = State(initialValue: place?.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.red) }
                TextField("Place name", text: $name)
                TextField("Latitude", text: $latitude).keyboardType(.numbersAndPunctuation)
                TextField("Longitude", text: $longitude).keyboardType(.numbersAndPunctuation)
                Text("Latitude: −90 to 90. Longitude: −180 to 180. Use decimal degrees, for example 7.0731, 125.6128.").font(.footnote).foregroundStyle(.secondary)
                Section("Notes") { TextEditor(text: $notes).accessibilityLabel("Notes").frame(minHeight: 100) }
            }
            .traceDraftProtection(isDirty: [name, latitude, longitude, notes] != initialDraft, isSaving: saving) { dismiss() }
            .traceWorkspace()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        Task {
                            saving = true
                            defer { saving = false }
                            guard let lat = Double(latitude), let lng = Double(longitude), lat.isFinite, lng.isFinite, (-90...90).contains(lat), (-180...180).contains(lng), !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                                error = "Enter a name and valid coordinates."
                                return
                            }
                            do { try await onSave(["name": name, "lat": lat, "lng": lng, "notes": notes]); dismiss() }
                            catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving)
                }
            }
        }
    }
}
