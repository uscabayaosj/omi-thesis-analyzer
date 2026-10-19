import CoreLocation
import Foundation
import Observation
import SwiftUI
import WebKit

struct ConversationPin: Codable, Sendable {
    var latitude: Double
    var longitude: Double
    var accuracy: Double?
    var observedSeconds: Double?
    var source: String?
    var address: String?
    var valid: Bool { latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180 }
    var label: String { address ?? String(format: "%.5f, %.5f", latitude, longitude) }
    func distance(to other: Self) -> Double {
        CLLocation(latitude: latitude, longitude: longitude).distance(from: CLLocation(latitude: other.latitude, longitude: other.longitude))
    }
}

extension ConversationPin {
    private enum CodingKeys: String, CodingKey { case latitude, longitude, accuracy, observedSeconds, source, address }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        latitude = (try? c.decode(Double.self, forKey: .latitude)) ?? .nan
        longitude = (try? c.decode(Double.self, forKey: .longitude)) ?? .nan
        accuracy = try? c.decode(Double.self, forKey: .accuracy)
        observedSeconds = try? c.decode(Double.self, forKey: .observedSeconds)
        source = try? c.decode(String.self, forKey: .source)
        address = try? c.decode(String.self, forKey: .address)
    }
}

@MainActor @Observable final class CaptureLocation: NSObject, CLLocationManagerDelegate {
    static let shared = CaptureLocation()
    var enabled = UserDefaults.standard.bool(forKey: "trace.location.enabled") {
        didSet { UserDefaults.standard.set(enabled, forKey: "trace.location.enabled"); reconcile() }
    }
    var status = "Location is optional."
    private let manager = CLLocationManager()
    private var recording = false
    private var samples: [CLLocation] = []
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
    }
    func setRecording(_ value: Bool) {
        if value && !recording { samples = [] }
        recording = value; reconcile()
    }
    private func reconcile() {
        guard enabled, recording else { manager.stopUpdatingLocation(); return }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
            status = "Attaching reliable locations while recording."
        default: status = "Location permission is off. Recordings continue without a pin."
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { reconcile() }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        samples += locations.filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 100 && abs($0.timestamp.timeIntervalSinceNow) < 60 }
        samples.removeAll { $0.timestamp < Date().addingTimeInterval(-600) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { status = "Location temporarily unavailable; recording continues." }
    func pin(start: Date, duration: Double) -> ConversationPin? {
        guard enabled else { return nil }
        let end = start.addingTimeInterval(duration)
        // Treat each reliable fix as valid for at most 60 seconds. Weight by observed time.
        let weighted = samples.enumerated().compactMap { index, fix -> (CLLocation, Double)? in
            let next = index + 1 < samples.count ? samples[index + 1].timestamp : end
            let a = max(start, fix.timestamp), b = min(end, min(next, fix.timestamp.addingTimeInterval(60)))
            let seconds = b.timeIntervalSince(a)
            return seconds > 0 ? (fix, seconds) : nil
        }
        guard let best = weighted.max(by: { a,b in
            weighted.filter { $0.0.distance(from: a.0) <= 100 }.reduce(0) { $0 + $1.1 } < weighted.filter { $0.0.distance(from: b.0) <= 100 }.reduce(0) { $0 + $1.1 }
        }) else { return nil }
        return ConversationPin(latitude: best.0.coordinate.latitude, longitude: best.0.coordinate.longitude,
            accuracy: best.0.horizontalAccuracy, observedSeconds: min(duration, weighted.filter { $0.0.distance(from: best.0) <= 100 }.reduce(0) { $0 + $1.1 }), source: "automatic")
    }
}

struct LeafletMap: UIViewRepresentable {
    @Binding var pin: ConversationPin
    var editable = false
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "pin")
        let view = WKWebView(frame: .zero, configuration: config)
        view.customUserAgent = "TRACE/1.0 personal conversation map"
        guard let url = Bundle.main.url(forResource: "map", withExtension: "html", subdirectory: "Map") else { return view }
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        view.navigationDelegate = context.coordinator
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self; context.coordinator.update(view) }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading(); view.navigationDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: "pin")
    }
    class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: LeafletMap
        init(_ parent: LeafletMap) { self.parent = parent }
        func update(_ view: WKWebView) {
            guard parent.pin.valid else { return }
            view.evaluateJavaScript("setPin(\(parent.pin.latitude),\(parent.pin.longitude),\(parent.editable ? "true" : "false"))")
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { update(webView) }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard parent.editable, let values = message.body as? [String: Double], let lat = values["latitude"], let lon = values["longitude"] else { return }
            let pin = ConversationPin(latitude: lat, longitude: lon, source: "manual")
            if pin.valid { parent.pin = pin }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.request.url?.isFileURL == true { decisionHandler(.allow) }
            else {
                if action.navigationType == .linkActivated, let url = action.request.url, url.host == "www.openstreetmap.org" { UIApplication.shared.open(url) }
                decisionHandler(.cancel)
            }
        }
    }
}

struct ConversationLocationSection: View {
    let id: String
    let original: ConversationPin?
    var saved: () async -> Void
    @State private var pin = ConversationPin(latitude: 0, longitude: 0, source: "manual")
    @State private var expanded = false
    @State private var editing = false
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        Section("Location") {
            if let original, original.valid {
                DisclosureGroup(original.label, isExpanded: $expanded) {
                    if expanded { LeafletMap(pin: .constant(original)).frame(height: 240) }
                }
            } else { Text("No location attached.").foregroundStyle(.secondary) }
            Button(original == nil ? "Add location" : "Edit location") {
                pin = original?.valid == true ? original! : ConversationPin(latitude: 51.5074, longitude: -0.1278, source: "manual")
                editing = true
            }
        .sheet(isPresented: $editing) {
            NavigationStack {
                Form {
                    LeafletMap(pin: $pin, editable: true).frame(height: 320)
                    Text("Tap the map or drag the pin. Coordinates can also be edited below.")
                    TextField("Latitude", value: $pin.latitude, format: .number).keyboardType(.numbersAndPunctuation)
                    TextField("Longitude", value: $pin.longitude, format: .number).keyboardType(.numbersAndPunctuation)
                    if let error { Text(error).foregroundStyle(.red) }
                }
                .navigationTitle("Conversation location")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editing = false }.disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(!pin.valid || saving) }
                }
            }
        }
        }
    }
    private func save() async {
        saving = true; error = nil
        defer { saving = false }
        do {
            let pathID = id.addingPercentEncoding(withAllowedCharacters: CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/%?#"))) ?? id
            let data = try JSONEncoder().encode(["geolocation": pin])
            _ = try await NativeConnection.shared.authenticatedRequest(path: "/api/native/v1/conversations/\(pathID)", method: "PATCH", body: data)
            await saved(); editing = false
            NotificationCenter.default.post(name: .traceConversationUpdated, object: id)
        } catch { self.error = error.localizedDescription }
    }
}
