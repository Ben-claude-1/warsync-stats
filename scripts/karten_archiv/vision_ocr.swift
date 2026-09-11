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
//
// Mit `--boxen` statt Text und Vertrauen ein JSON-Feld mit jeder erkannten
// Zeile samt Lage in Bildpixeln (Ursprung oben links): Pfad TAB [{t,c,x,y,w,h}].
// Gebraucht fuer Listen, in denen erst die Lage sagt, was zusammengehoert —
// die Rangliste im Wuestensturm-Kampfergebnis (scripts/ws_service/ergebnis.py).
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

func boxen(_ pfad: String, korrektur: Bool) -> String {
    guard let bild = NSImage(contentsOfFile: pfad),
          let cg = bild.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return "[]"
    }
    let anfrage = VNRecognizeTextRequest()
    anfrage.recognitionLevel = .accurate
    anfrage.usesLanguageCorrection = korrektur
    anfrage.recognitionLanguages = ["en-US", "de-DE"]
    let leser = VNImageRequestHandler(cgImage: cg, options: [:])
    guard (try? leser.perform([anfrage])) != nil else { return "[]" }
    let w = Double(cg.width), h = Double(cg.height)
    var aus: [[String: Any]] = []
    for beob in anfrage.results ?? [] {
        guard let k = beob.topCandidates(1).first else { continue }
        let r = beob.boundingBox   // normiert, Ursprung unten links
        aus.append(["t": k.string, "c": Double(k.confidence),
                    "x": r.minX * w, "y": (1 - r.maxY) * h,
                    "w": r.width * w, "h": r.height * h])
    }
    let daten = (try? JSONSerialization.data(withJSONObject: aus)) ?? Data("[]".utf8)
    return String(data: daten, encoding: .utf8) ?? "[]"
}

let args = Array(CommandLine.arguments.dropFirst())
let korrektur = args.contains("--korrektur")
let mitBoxen = args.contains("--boxen")

if args.contains("--dienst") {
    setbuf(stdout, nil)
    while let pfad = readLine(strippingNewline: true) {
        if pfad.isEmpty { continue }
        if mitBoxen {
            print("\(pfad)\t\(boxen(pfad, korrektur: korrektur))")
            continue
        }
        let (text, sicher) = lesen(pfad, korrektur: korrektur)
        print("\(pfad)\t\(text)\t\(String(format: "%.2f", sicher))")
    }
} else {
    for pfad in args where !pfad.hasPrefix("--") {
        if mitBoxen {
            print("\(pfad)\t\(boxen(pfad, korrektur: korrektur))")
            continue
        }
        let (text, sicher) = lesen(pfad, korrektur: korrektur)
        print("\(pfad)\t\(text)\t\(String(format: "%.2f", sicher))")
    }
}
