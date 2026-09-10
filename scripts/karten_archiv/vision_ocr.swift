// Die Texterkennung von macOS als Werkzeug — `VNRecognizeTextRequest`.
//
// Sie liest die Namensschilder deutlich besser als Tesseract, und zwar auf dem
// **farbigen** Ausschnitt statt auf der freigestellten Maske. An den drei
// Wahrheiten des Kartenarchivs gemessen (09.09.2026): 33 von 38 Namen genau
// richtig gegen 24 von 38.
//
// Zwei Betriebsarten:
//   ocr bild1.png bild2.png ...   — einmalig, eine Zeile Ausgabe je Bild
//   ocr --dienst                  — liest Pfade zeilenweise von der Eingabe
//
// Die zweite gibt es wegen der Anlaufzeit: ein einzelner Aufruf dauert 0,17 s,
// im Dienst sind es 0,05 s je Bild. Bei zweieinhalbtausend Schildern je Archiv
// ist das der Unterschied zwischen sieben Minuten und zwei.
//
// Ausgabe je Zeile: Pfad TAB Text TAB Vertrauen.
import Foundation
import Vision
import AppKit

func lesen(_ pfad: String, korrektur: Bool) -> (String, Double) {
    guard let bild = NSImage(contentsOfFile: pfad),
          let cg = bild.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return ("", 0.0)
    }
    let anfrage = VNRecognizeTextRequest()
    anfrage.recognitionLevel = .accurate
    // **Ohne Sprachkorrektur.** Spielernamen sind keine Woerter; die Korrektur
    // biegt sie auf das naechste Woerterbuchwort zurecht.
    anfrage.usesLanguageCorrection = korrektur
    anfrage.recognitionLanguages = ["en-US", "de-DE"]
    let leser = VNImageRequestHandler(cgImage: cg, options: [:])
    guard (try? leser.perform([anfrage])) != nil else { return ("", 0.0) }
    let zeilen = (anfrage.results ?? []).compactMap { $0.topCandidates(1).first }
    let text = zeilen.map { $0.string }.joined(separator: " ")
    let sicher = zeilen.map { Double($0.confidence) }.reduce(0, +) / Double(max(1, zeilen.count))
    return (text, sicher)
}

let args = Array(CommandLine.arguments.dropFirst())
let korrektur = args.contains("--korrektur")

if args.contains("--dienst") {
    setbuf(stdout, nil)
    while let pfad = readLine(strippingNewline: true) {
        if pfad.isEmpty { continue }
        let (text, sicher) = lesen(pfad, korrektur: korrektur)
        print("\(pfad)\t\(text)\t\(String(format: "%.2f", sicher))")
    }
} else {
    for pfad in args where !pfad.hasPrefix("--") {
        let (text, sicher) = lesen(pfad, korrektur: korrektur)
        print("\(pfad)\t\(text)\t\(String(format: "%.2f", sicher))")
    }
}
