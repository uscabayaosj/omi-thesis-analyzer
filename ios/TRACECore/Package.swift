// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TRACECore",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "TRACECore", targets: ["TRACECore"]),
    ],
    targets: [
        .target(name: "TRACECore"),
        .testTarget(name: "TRACECoreTests", dependencies: ["TRACECore"]),
    ]
)
