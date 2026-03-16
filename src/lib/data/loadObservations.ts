import * as XLSX from "xlsx";

const SPREADSHEET_URL = "./Multilingual_Amsterdam_voorGees.xlsx";
const SPEADSHEET_URL2 = "./School_data.xlsx";
const ISO_CODES_URL = "./iso_codes.json";

let isoCodes: { code: string; NL: string; EN: string }[] = [];

const TERUGVAL_TALEN: Record<string, string> = {
    '"nigeriaans"': "pcm",
    'ara ("Marokkaans")': "ary",
    "ara (Marokkaans)": "ary",
    chinees: "cmn",
    '"chinees"': "cmn",
    '"indiaas"': "Indiaas (hindi?)",
    '"afrikaans"': "afr",
    g: "G?"
};

export type Observation = {
    observationId: number;
    code: string;
    displayName: string;
    postcode: string;
    locationName: string;
    stadsdeel: string;
    interviewers: string;
    interviewDate: string;
    proficient: boolean;
    basic: boolean;
    homeLanguage: boolean;
};

export type Respondent = {
    respondentId: number;
    locationName: string;
    stadsdeel: string;
    postcode: string;
    languages: RespondentLanguage[];
}

export type RespondentLanguage = {
    code: string;
    nameNL: string;
    nameEN: string;
    proficient: boolean;
    basic: boolean;
    homeLanguage: boolean;
}

export async function loadData(locale: "nl" | "en" = "nl") {
    const res = await fetch("./talenkaart_data.xlsx");
    const buffer = await res.arrayBuffer();
    const workbook = XLSX.read(buffer);
}

function makeDisplayName(code: string, locale: string) {
    if (!code) return "(!)";

    const exact = isoCodes.find((c) => c.code === code);
    if (exact) {
        return exact[locale.toUpperCase()] || exact.code;
    }

    if (TERUGVAL_TALEN[code]) {
        return code + " (!!)";
    }

    try {
        const dn = new Intl.DisplayNames([locale], { type: "language" });
        const display = dn.of(code);

        if (!display || display.toLowerCase() === code.toLowerCase()) {
            return `${code} (!)`;
        }

        return display;
    } catch {
        return `${code} (!)`;
    }
}

export async function loadObservations(locale: "nl" | "en" = "nl") {
    const [spreadsheetRes, isoCodesRes] = await Promise.all([
        fetch(SPREADSHEET_URL),
        fetch(ISO_CODES_URL)
    ]);

    const buffer = await spreadsheetRes.arrayBuffer();
    const workbook = XLSX.read(buffer);
    isoCodes = await isoCodesRes.json();

    const sheetNames = ["Zuidoost", "NieuwWest"];
    const observations: Observation[] = [];

    let observationId = 0;

    for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const dataRows = rows.slice(2);

        for (const row of dataRows) {
            if (!row || row.length === 0) continue;

            const locationName = row[0];
            const interviewers = row[1];
            const interviewDate = row[2];
            const postcode = row[3] || "";
            const stadsdeel = sheetName.replace("NieuwWest", "Nieuw-West");

            const proficientLangs = (row[5] ?? "").toString();
            const basicLangs = (row[6] ?? "").toString();
            const homeLangs = (row[7] ?? "").toString();

            const proficientList = proficientLangs
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);
            const basicList = basicLangs
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);
            const homeList = homeLangs
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);

            const allLangs = new Set([
                ...proficientList,
                ...basicList,
                ...homeList
            ]);

            for (const code of allLangs) {
                observations.push({
                    observationId,
                    code,
                    displayName: makeDisplayName(code, locale),
                    postcode,
                    locationName,
                    stadsdeel,
                    interviewers,
                    interviewDate,
                    proficient: proficientList.includes(code),
                    basic: basicList.includes(code),
                    homeLanguage: homeList.includes(code)
                });
            }

            observationId++;
        }
    }

    console.log(observations);
    return observations;
}

export async function loadSchoolData() {
    const res = await fetch(SPEADSHEET_URL2);
    const buffer = await res.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[2]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const dataRows = rows.slice(1);

    const noConversion = new Set();

    dataRows.forEach((row, i) => {
        row.slice(1).forEach((lang) => {
            if (isoCodes.find((c) => c.NL === lang)) return;
            noConversion.add(lang);
        });
    });

    console.log("Talen zonder ISO-code:", Array.from(noConversion));

    return dataRows.map((row) => ({
        locationName: row[0],
        languages: row.slice(1).filter(x => !noConversion.has(x)),
        codes: row.slice(1).map((lang) => {
            const found = isoCodes.find((c) => c.NL === lang);
            if (found) return found.code;
        })
    }));
}