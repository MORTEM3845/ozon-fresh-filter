(() => {
    "use strict";

    const Parser = globalThis.OzonFreshParser;

    if (!Parser)
        return;

    function normalizeText(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim();
    }

    function parseDecimal(value) {
        const match = normalizeText(value).replace(/\u00a0/g, " ").match(/-?\d+(?:[.,]\d+)?/);

        if (!match)
            return null;

        const number = Number(match[0].replace(",", "."));
        return Number.isFinite(number) ? number : null;
    }

    function collectTexts(node, result, depth = 0) {
        if (node == null || depth > 11)
            return;

        if (typeof node === "string" || typeof node === "number") {
            const text = normalizeText(node);

            if (text)
                result.push(text);

            return;
        }

        if (Array.isArray(node)) {
            for (const value of node)
                collectTexts(value, result, depth + 1);

            return;
        }

        if (typeof node !== "object")
            return;

        for (const [key, value] of Object.entries(node)) {
            result.push(normalizeText(key));
            collectTexts(value, result, depth + 1);
        }
    }

    function findValue(texts, patterns, max) {
        for (const text of texts) {
            for (const pattern of patterns) {
                const match = text.match(pattern);
                const value = match ? parseDecimal(match[1]) : null;

                if (value != null && value >= 0 && value <= max)
                    return value;
            }
        }

        return null;
    }

    function extractNutrition(value) {
        const texts = [];
        collectTexts(value, texts);

        if (typeof value === "string")
            texts.push(...value.split(/[\n|;]/).map(normalizeText).filter(Boolean));

        const proteins = findValue(texts, [
            /(?:белк(?:и|ов|а)?|proteins?)\s*(?:,?\s*(?:г|g))?\s*(?:[:=—–-]|\|)?\s*(\d+(?:[.,]\d+)?)/i,
            /(\d+(?:[.,]\d+)?)\s*(?:г|g)\s*(?:белк(?:и|ов|а)?|proteins?)/i
        ], 1000);
        const fats = findValue(texts, [
            /(?:жир(?:ы|ов|а)?|fats?)\s*(?:,?\s*(?:г|g))?\s*(?:[:=—–-]|\|)?\s*(\d+(?:[.,]\d+)?)/i,
            /(\d+(?:[.,]\d+)?)\s*(?:г|g)\s*(?:жир(?:ы|ов|а)?|fats?)/i
        ], 1000);
        const carbs = findValue(texts, [
            /(?:углевод(?:ы|ов|а)?|carbohydrates?|carbs?)\s*(?:,?\s*(?:г|g))?\s*(?:[:=—–-]|\|)?\s*(\d+(?:[.,]\d+)?)/i,
            /(\d+(?:[.,]\d+)?)\s*(?:г|g)\s*(?:углевод(?:ы|ов|а)?|carbohydrates?|carbs?)/i
        ], 1000);
        const calories = findValue(texts, [
            /(?:калорийность|энергетическая\s+ценность|калории|calories?)\s*(?:,?\s*(?:ккал|kcal))?\s*(?:[:=—–-]|\|)?\s*(\d+(?:[.,]\d+)?)/i,
            /(\d+(?:[.,]\d+)?)\s*(?:ккал|kcal)\b/i
        ], 5000);

        if ([proteins, fats, carbs, calories].every(x => x == null))
            return null;

        const joined = texts.join(" ");
        const basis = /100\s*мл/i.test(joined) ? "100 мл" : /100\s*г/i.test(joined) ? "100 г" : /на\s+порци(?:ю|и)/i.test(joined) ? "порция" : "";

        return { proteins, fats, carbs, calories, basis };
    }

    function extractWeightGrams(value) {
        const texts = [];
        collectTexts(value, texts);

        if (typeof value === "string")
            texts.unshift(normalizeText(value));

        for (const text of texts) {
            const normalized = text.toLocaleLowerCase("ru-RU");
            const kgMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*кг\b/);

            if (kgMatch) {
                const kilograms = parseDecimal(kgMatch[1]);

                if (kilograms != null && kilograms > 0 && kilograms <= 100)
                    return Math.round(kilograms * 1000);
            }

            const gramMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:г|гр)\b/);

            if (gramMatch) {
                const grams = parseDecimal(gramMatch[1]);

                if (grams != null && grams > 0 && grams <= 100000)
                    return Math.round(grams);
            }
        }

        return null;
    }

    function parseProductDetails(value) {
        const response = Parser.parseJson(value);

        return response
            ? { validJson: true, nutrition: extractNutrition(response), weightGrams: extractWeightGrams(response) }
            : { validJson: false, nutrition: null, weightGrams: null };
    }

    Parser.extractNutrition = extractNutrition;
    Parser.extractWeightGrams = extractWeightGrams;
    Parser.parseProductDetails = parseProductDetails;
})();
