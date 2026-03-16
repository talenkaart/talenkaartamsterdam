import * as XLSX from "xlsx";

export type Locatie = {
    id: number;
    naam: string;
    coordinaten: [number, number];
    type: "school" | "bibliotheek" | "cultureel";
    stadsdeel: string;
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

    // 1. Talen sheet inlezen voor "vertalingen van talen" (ISO 639-3 > NL + EN)
    const talenSheet = XLSX.utils.sheet_to_json<{ "ISO 639-3": string, NL: string, EN: string }>(workbook.Sheets["Talen"]);
    const talenMap = new Map(talenSheet.map(t => [t["ISO 639-3"], { nl: t.NL, en: t.EN }]));

    // 2. Locaties inlezen
    const locatiesRaw = XLSX.utils.sheet_to_json<any>(workbook.Sheets["Locaties"]);
    if (locatiesRaw.filter(i => !i.Coordinaten)) console.warn("Locaties met missende coordinaten: ", locatiesRaw.filter(i => !i.Coordinaten))
    const locations: Locatie[] = locatiesRaw
        .filter(l => l.Coordinaten)
        .map((l, i) => ({
            id: i + 1,
            naam: l.Naam,
            coordinaten: l.Coordinaten.split(',').map((c: string) => parseFloat(c.trim())) as [number, number],
            stadsdeel: l.Stadsdeel,
            type: l.Type.toLowerCase() as "school" | "bibliotheek" | "cultureel"
        }));

    // 3. Respondenten inlezen
    const respondentenSheet = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets["Respondenten"], { header: 1 });
    const [header, ...rows] = respondentenSheet;

    const respondents: Respondent[] = rows.map((row, index) => {
        const locationName = row[0];
        const stadsdeel = row[1];
        const postcode = row[2] || "";

        const vloeiend = (row[3] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        const basis = (row[4] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        const thuis = (row[5] || "").split(",").map((s: string) => s.trim()).filter(Boolean);

        const alleTalen = Array.from(new Set([...vloeiend, ...thuis, ...basis]));

        const languages: RespondentLanguage[] = alleTalen.map(code => {
            const vertaling = talenMap.get(code);
            return {
                code: code,
                nameNL: vertaling?.nl || code,
                nameEN: vertaling?.en || code,
                proficient: vloeiend.includes(code),
                homeLanguage: thuis.includes(code),
                basic: basis.includes(code)
            };
        });

        return {
            respondentId: index + 1,
            locationName,
            stadsdeel,
            postcode,
            languages
        };
    });

    return { locations, respondents };
}