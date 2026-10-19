import SwiftUI

struct NativePrivacyView: View {
    var body: some View {
        List {
            Section("Recording is your choice") {
                Text("Capture starts paused when TRACE opens. Resume capture starts saving audio from your DevKit; Pause capture stops saving new audio. Finish conversation pauses capture and completes the current conversation. Record only when the people involved have agreed.")
            }
            Section("Audio and live text") {
                Text("Recordings are saved on this iPhone. After enrollment, new recordings upload to your TRACE server for transcription. Live audio is also sent to Deepgram to display captions. Older recordings stay local until you choose Upload for transcription.")
                Text("Successful processing deletes the server’s temporary raw audio. Failed processing can retain private audio for retries; cleanup runs through the server’s retry jobs, including a seven-day retry limit. Outages can delay cleanup. Original recordings remain on this iPhone.")
            }
            Section("Optional reference voices and locations") {
                Text("Voice recognition is off until you enable it. Reference setup records only when you tap Record; saving sends that short sample to your private TRACE server. When recognition is enabled, completed conversation audio and saved references are sent to OpenAI. Matches stay suggestions until you confirm them. You can delete reference samples in Settings; deleting one does not erase previous transcript corrections.")
                Text("Locations are optional and collected only during Capture. Reliable fixes are stored with local audio chunks and uploaded with enrolled captures to attach an automatic conversation pin. Manual map corrections are saved on the server. Map tiles are requested from OpenStreetMap when you open a map.")
            }
            Section("Summaries and research") {
                Text("The server saves transcripts, summaries, and action items. It sends transcript text to its configured AI provider to create these results. The qualified test server uses OpenAI for summaries and Deepgram for speech recognition. Optional ADHD Aid, Research, and Ask features also process saved text using the server’s configured AI provider.")
                Text("AI results can be mistaken. Check important names, decisions, and commitments against the transcript. ADHD Aid is a planning feature.")
                Text("Ask saves your questions, answers, and sources in the shared workspace. TRACE also saves AI token counts, model names, and estimated costs so you can review usage.")
            }
            Section("Your workspace and access") {
                Text("TRACE uses one shared personal workspace. Enrolled installations can read and update its conversations, People, analyses, and backups. The server stores an installation identifier and label to manage access and capture processing.")
                Text("Your installation credential is stored in this iPhone’s Keychain. AI provider keys stay on the server. Revoke this iPhone disables server access; it does not erase local recordings or saved server data. Ask your workspace operator about server data removal and retention before enrolling.")
            }
            Section("Providers and storage") {
                Text("The qualified test workspace uses Vercel for hosting and private temporary audio storage, and Neon for saved server records. Provider retention and operational logs depend on the operator’s configuration and provider terms. TRACE has no advertising or cross-app tracking feature.")
                Text("Server backup exports shared analyses, People, codes and planning records. It excludes native capture conversations, their pins and deletion markers, voice references, and original audio. Files you share or export are handled by the destination you choose. Keep exported recordings and backups private.")
            }
        }
        .traceWorkspace()
        .navigationTitle("Privacy and recording")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("trace.privacy")
    }
}
