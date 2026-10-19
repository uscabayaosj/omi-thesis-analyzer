import SwiftUI

struct NativeSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var connection = NativeConnection.shared
    @State private var serverURL = NativeConnection.shared.serverURL
    @State private var label = "My iPhone"
    @State private var bootstrapSecret = ""
    @State private var confirmingRevocation = false

    var body: some View {
        NavigationStack {
            Form {
                Section("TRACE") {
                    NavigationLink { DevKitControlsView() } label: {
                        Label("DevKit controls", systemImage: "hand.tap")
                    }.accessibilityIdentifier("trace.settings.devKitControls")
                    NavigationLink { RecordingAlertsView() } label: {
                        Label("Recording alerts", systemImage: "bell.badge")
                    }
                    .accessibilityIdentifier("trace.settings.recordingAlerts")
                    NavigationLink {
                        NativeHelpView()
                    } label: {
                        Label("How this works", systemImage: "questionmark.circle")
                    }
                    NavigationLink {
                        NativePrivacyView()
                    } label: {
                        Label("Privacy and recording", systemImage: "hand.raised")
                    }
                    .accessibilityIdentifier("trace.settings.privacy")
                }
                if connection.enrolled {
                    Section("Your data") {
                        NavigationLink { NativeVoiceProfilesView() } label: { Label("Voice recognition", systemImage: "person.wave.2") }
                            .accessibilityIdentifier("trace.settings.voices")
                        NavigationLink { NativeUsageView() } label: { Label("Usage", systemImage: "chart.pie") }
                        NavigationLink { NativeBackupView() } label: { Label("Backup and restore", systemImage: "externaldrive") }
                        NavigationLink { NativeReminderView() } label: { Label("Reminders", systemImage: "bell") }
                    }
                }
                Section("TRACE server") {
                    TextField("https://trace.example.com", text: $serverURL)
                        .accessibilityIdentifier("trace.settings.server")
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    LabeledContent("Status", value: connection.status)
                    if connection.enrolled {
                        LabeledContent("Installation", value: connection.installationLabel)
                    }
                }

                if !connection.enrolled {
                    Section("Enroll this iPhone") {
                        Text("TRACE connects to your shared personal workspace. Every enrolled iPhone can access that workspace’s conversations, People, and analyses. Use only the server and enrollment secret supplied by your workspace operator.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        TextField("Device label", text: $label)
                            .textInputAutocapitalization(.words)
                        SecureField("Operator enrollment secret", text: $bootstrapSecret)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Text("The enrollment secret is sent once over HTTPS. The installation token is stored in this iPhone’s Keychain.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button {
                            let secret = bootstrapSecret
                            Task {
                                await connection.enroll(server: serverURL, label: label, bootstrapSecret: secret)
                                bootstrapSecret = ""
                            }
                        } label: {
                            if connection.isBusy { ProgressView() }
                            else { Text("Enroll") }
                        }
                        .disabled(connection.isBusy || serverURL.isEmpty || label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bootstrapSecret.isEmpty)
                    }
                } else {
                    Section {
                        Button("Check connection", systemImage: "arrow.clockwise") {
                            do {
                                try connection.saveServerURL(serverURL)
                                Task { await connection.refreshStatus() }
                            } catch {
                                connection.errorMessage = error.localizedDescription
                            }
                        }
                        .disabled(connection.isBusy)
                        Button("Revoke this iPhone", systemImage: "xmark.shield", role: .destructive) {
                            confirmingRevocation = true
                        }
                        .disabled(connection.isBusy)
                    } footer: {
                        Text("Revoking disables this installation’s server access. Local capture files remain on this iPhone.")
                    }
                }

                if let error = connection.errorMessage {
                    Section("Connection issue") {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .traceWorkspace()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("Revoke this iPhone?", isPresented: $confirmingRevocation) {
                Button("Revoke server access", role: .destructive) { Task { await connection.revokeThisInstallation() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This iPhone will lose access to your TRACE workspace. Local recordings remain on the phone. You will need the enrollment secret to connect again.")
            }
            .task {
                if connection.enrolled { await connection.refreshStatus() }
            }
        }
    }
}

struct NativeHelpView: View {
    var body: some View {
        List {
            Section("Conversations") {
                DisclosureGroup("What is the basic TRACE workflow?") {
                    Text("Capture audio from your DevKit, read the live text, then save the completed conversation with its transcript, title, summary, and stated action items. The ordinary summary is automatic. ADHD Aid and Research are optional analyses you can run afterwards.")
                }
            }
            Section("Research") {
                DisclosureGroup("What are Thesis and ADHD Aid?") {
                    Text("Thesis reads a conversation as fieldwork across the four research questions, orienting conditions, a rival hypothesis, refutation signals, and forward thinking. ADHD Aid reads it for commitments, decisions, people owed a reply, and open loops. They run independently; one analysis does not shape the other.")
                }
                DisclosureGroup("Daily review or weekly review?") {
                    Text("A daily review reviews that day’s ADHD Aid analyses and the previous daily plan, then prepares the next day. A weekly review summarizes the daily reviews already saved for that week. It cannot fill in days without a daily review.")
                }
                DisclosureGroup("What does a promise’s age mean?") {
                    Text("An unresolved commitment can carry forward through daily plans, with its age increasing. Older commitments may need a new agreement or a decision to let them go. Marking one done or let go stops it appearing as open.")
                }
                DisclosureGroup("What does Let go mean?") {
                    Text("Let go records that a task, promise, or loop is no longer active. It keeps that decision visible instead of making the item disappear as if it had been completed.")
                }
                DisclosureGroup("What do Ask, Codebook, and Patterns do?") {
                    Text("Ask searches saved thesis and group analyses for relevant passages and returns an answer with sources. Codebook organizes codes and excerpts; suggestions stay pending until you accept them. Patterns summarizes saved ADHD analyses and reviews in your shared workspace without another model request.")
                }
                DisclosureGroup("What is the difference between the two searches?") {
                    Text("The conversation list’s search filters conversation titles and summaries. Search inside the Research tab looks inside saved thesis and group analysis text.")
                }
            }

            Section("Your data") {
                DisclosureGroup("Where does my data live?") {
                    Text("After this iPhone is enrolled, conversation and analysis features read or update the TRACE server over HTTPS. The installation credential is kept in this iPhone’s Keychain; AI provider credentials remain on the server. Some views keep temporary or device-local state for their workflows.")
                }
                DisclosureGroup("What does Backup and restore include?") {
                    Text("Backup exports shared analyses, People, codes, planning records, and their tombstones. Native capture conversations, their pins and deletion markers, reference voices, and local audio are excluded. Restore previews the record counts and merges records using their timestamps; it does not replace newer server records. The export is paged rather than a single transactional snapshot.")
                }
                DisclosureGroup("Does backup include captured audio?") {
                    Text("No. DevKit audio chunks are stored locally on this iPhone and are not included in server backup. New recordings upload for transcription only after this installation is enrolled; older chunks require an explicit Upload for transcription action. The original local chunks stay on this iPhone. The server deletes its temporary raw audio after saving the transcript and conversation.")
                }
            }

            Section("Capture") {
                DisclosureGroup("What happens when I connect the DevKit?") {
                    Text("TRACE reads the DevKit’s codec and battery information, then receives live audio over Bluetooth and writes framed capture chunks on this iPhone. Capture starts paused whenever TRACE launches, including after Bluetooth state restoration. Tap Resume capture when you want to record; use Pause capture to stop saving incoming frames. When enrolled, new chunks upload over the authenticated connection and remain on this iPhone after server acceptance. BLE may reconnect to the paired device when TRACE starts again.")
                }
                DisclosureGroup("Will a recording appear in Conversations?") {
                    Text("Yes, when this installation is enrolled and capture processing is configured. Audio streams to Deepgram for live text while originals are saved locally. TRACE uses the uploaded recording for the complete transcript, then automatically creates a title, summary, and stated action items. A conversation ends after 90 seconds of silence or when you tap Finish conversation, which also pauses capture. The server deletes temporary raw audio after saving the transcript; summary retries use the saved text. Older captures stay local unless you choose Upload for transcription.")
                }
            }
        }
        .navigationTitle("How TRACE works")
        .navigationBarTitleDisplayMode(.inline)
    }
}
