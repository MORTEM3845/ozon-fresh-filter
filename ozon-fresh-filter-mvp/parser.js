(() => {
    "use strict";

    const CATEGORY_RULES = [
        ["Супы", ["суп", "борщ", "щи ", "щи,", "солянк", "уху", "уха", "рассольник", "окрошк", "бульон", "том ям", "фо бо", "минестроне", "харчо", "крем-суп"]],
        ["Завтраки", ["завтрак", "каша", "сырник", "блин", "панкейк", "олад", "омлет", "яичниц", "гранола", "мюсли", "крок месье", "круассан с", "творожная запеканка"]],
        ["Салаты", ["салат", "винегрет", "цезарь", "оливье", "мимоза"]],
        ["Вторые блюда", ["лапша", "паста", "спагетти", "плов", "ризотто", "котлет", "пюре", "гречк", "макарон", "гуляш", "рагу", "жаркое", "пельмен", "вареник", "хинкал", "голубц", "тефтел", "фрикадел", "лазан", "стейк", "шашлык", "наггетс", "картофель", "рис с", "соба", "удон", "фунчоз"]],
        ["Закуски", ["онигири", "сэндвич", "сандвич", "буррито", "шаурм", "ролл", "хот-дог", "наггетс", "чебурек", "самса", "хумус", "паштет", "закуска", "спаржа соевая"]],
        ["Выпечка", ["хлеб", "булоч", "пирог", "пирож", "слойк", "круассан", "багет", "лаваш", "лепеш", "ватруш", "штрудель"]],
        ["Десерты", ["десерт", "торт", "пирожное", "чизкейк", "морожен", "печенье", "шоколад", "конфет", "мармелад", "зефир", "пастила", "вафл", "пончик"]],
        ["Напитки", ["напиток", "сок", "морс", "лимонад", "вода", "кофе", "чай", "какао", "компот", "квас", "смузи"]],
        ["Молочные продукты", ["молоко", "кефир", "ряженка", "йогурт", "творог", "сметана", "сливки", "сыр "]],
        ["Соусы", ["соус", "кетчуп", "майонез", "горчица", "аджика", "терияки"]],
        ["Мясо и птица", ["курица", "индейка", "говядина", "свинина", "ветчина", "колбаса", "сосиск", "бекон"]],
        ["Рыба и морепродукты", ["рыба", "лосось", "семга", "тунец", "кревет", "кальмар", "мидии", "морепродукт"]]
    ];

    function normalizeText(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function parseMoney(value) {
        const digits = String(value || "").replace(/[^\d]/g, "");
        return digits ? Number(digits) : null;
    }

    function parseInteger(value) {
        const digits = String(value || "").replace(/[^\d]/g, "");
        return digits ? Number(digits) : 0;
    }

    function parseDecimal(value) {
        const match = String(value ?? "").replace(/\u00a0/g, " ").match(/-?\d+(?:[.,]\d+)?/);

        if (!match)
            return null;

        const number = Number(match[0].replace(",", "."));
        return Number.isFinite(number) ? number : null;
    }

    function parseJson(value) {
        if (!value)
            return null;

        if (typeof value === "object")
            return value;

        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    function cleanProductUrl(value) {
        try {
            const url = new URL(value, "https://www.ozon.ru");
            url.searchParams.delete("at");
            url.hash = "";
            return url.toString();
        } catch {
            return "";
        }
    }

    function findMainState(item, type) {
        const state = item?.mainState?.find(x => x?.type === type);
        return state?.[type] || null;
    }

    function findTitleState(item) {
        const named = item?.mainState?.find(x => x?.type === "textDS" && x?.id === "name");
        return named?.textDS || findMainState(item, "textDS");
    }

    function collectTexts(node, result, depth = 0) {
        if (node == null || depth > 7)
            return;

        if (typeof node === "string") {
            const text = normalizeText(node);

            if (text && text.length <= 500 && !/^https?:\/\//i.test(text))
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

        for (const value of Object.values(node))
            collectTexts(value, result, depth + 1);
    }

    function extractRatingFromTexts(values) {
        const texts = values.map(normalizeText).filter(Boolean);
        const combined = texts.join(" | ");
        const combinedMatch = combined.match(/(?:★|⭐|рейтинг\s*)?([0-5](?:[.,]\d))\s*(?:[·•|]|из\s*5)?\s*(\d[\d\s]*)?\s*(?:отзыв\w*|оцен\w*)/i);

        if (combinedMatch) {
            return {
                rating: Number(combinedMatch[1].replace(",", ".")),
                reviewCount: parseInteger(combinedMatch[2])
            };
        }

        const ratingIndex = texts.findIndex(x => /^(?:★|⭐)?\s*[0-5](?:[.,]\d)$/.test(x));

        if (ratingIndex < 0)
            return { rating: null, reviewCount: 0 };

        const rating = Number(texts[ratingIndex].replace(/[^\d.,]/g, "").replace(",", "."));
        const nearby = texts.slice(ratingIndex + 1, ratingIndex + 4);
        const reviewsText = nearby.find(x => /^\d[\d\s]*$/.test(x) || /\d[\d\s]*\s*(?:отзыв|оцен)/i.test(x));

        return { rating, reviewCount: parseInteger(reviewsText) };
    }

    function extractRating(item) {
        const label = findMainState(item, "labelListV2");
        const labelTexts = [];
        collectTexts(label?.items || [], labelTexts);

        const fromLabels = extractRatingFromTexts(labelTexts);

        if (fromLabels.rating)
            return fromLabels;

        const allTexts = [];
        collectTexts(item?.mainState || [], allTexts);
        return extractRatingFromTexts(allTexts);
    }

    function extractRatingFromText(value) {
        const lines = String(value || "").split(/\n+/).map(normalizeText).filter(Boolean);
        return extractRatingFromTexts(lines);
    }

    function containsEatSoon(value) {
        return /съешьте\s+скорее|успейте\s+съесть|короткий\s+срок\s+годности/i.test(String(value || ""));
    }


    function validNutritionValue(value, max) {
        return Number.isFinite(value) && value >= 0 && value <= max ? value : null;
    }

    function assignNutritionValue(result, key, value) {
        const max = key === "calories" ? 5000 : 1000;
        const parsed = validNutritionValue(parseDecimal(value), max);

        if (parsed != null && result[key] == null)
            result[key] = parsed;
    }

    function nutritionKey(value) {
        const key = normalizeText(value).toLocaleLowerCase("ru-RU").replace(/[\s_\-.,:()]/g, "");

        if (/^(?:protein|proteins|белки|белков|белок)$/.test(key))
            return "proteins";

        if (/^(?:fat|fats|жиры|жиров|жир)$/.test(key))
            return "fats";

        if (/^(?:carb|carbs|carbohydrate|carbohydrates|углеводы|углеводов|углевод)$/.test(key))
            return "carbs";

        if (/^(?:calorie|calories|kcal|ккал|калорийность|энергетическаяценность)$/.test(key))
            return "calories";

        return "";
    }

    function extractNutritionFromObjects(node, result, depth = 0) {
        if (!node || depth > 9)
            return;

        if (Array.isArray(node)) {
            for (const value of node)
                extractNutritionFromObjects(value, result, depth + 1);

            return;
        }

        if (typeof node !== "object")
            return;

        const label = node.name ?? node.title ?? node.label ?? node.key ?? node.parameter ?? node.characteristic;
        const value = node.value ?? node.values ?? node.description ?? node.subtitle ?? node.content;
        const labeledKey = nutritionKey(label);

        if (labeledKey && value != null)
            assignNutritionValue(result, labeledKey, Array.isArray(value) ? value.join(" ") : value);

        for (const [key, nestedValue] of Object.entries(node)) {
            const directKey = nutritionKey(key);

            if (directKey && (typeof nestedValue === "string" || typeof nestedValue === "number"))
                assignNutritionValue(result, directKey, nestedValue);

            if (typeof nestedValue === "object")
                extractNutritionFromObjects(nestedValue, result, depth + 1);
        }
    }

    function extractNutritionValue(texts, labelPattern, max) {
        const unit = "(?:г|гр|g)?";
        const separator = "(?:\\s*[,;]?\\s*" + unit + "\\s*)?(?:[:=—–-]|\\|)?\\s*";
        const direct = new RegExp("(?:" + labelPattern + ")" + separator + "(\\d+(?:[.,]\\d+)?)", "i");
        const reverse = new RegExp("(\\d+(?:[.,]\\d+)?)\\s*(?:г|гр|g)\\s*(?:" + labelPattern + ")", "i");

        for (const text of texts) {
            const match = text.match(direct) || text.match(reverse);
            const parsed = match ? validNutritionValue(parseDecimal(match[1]), max) : null;

            if (parsed != null)
                return parsed;
        }

        const exactLabel = new RegExp("^(?:" + labelPattern + ")(?:\\s*[,;]?\\s*(?:г|гр|g|ккал|kcal))?$", "i");

        for (let index = 0; index < texts.length - 1; index++) {
            if (!exactLabel.test(texts[index]))
                continue;

            for (const nearby of texts.slice(index + 1, index + 3)) {
                const parsed = validNutritionValue(parseDecimal(nearby), max);

                if (parsed != null)
                    return parsed;
            }
        }

        return null;
    }

    function extractCalories(texts) {
        const patterns = [
            /(?:калорийность|энергетическая\s+ценность)(?:\s*[,;:]?\s*(?:ккал|kcal)(?:\s*\/\s*100\s*(?:г|мл))?)?\s*(?:[:=—–-]|\|)?\s*(\d+(?:[.,]\d+)?)/i,
            /(\d+(?:[.,]\d+)?)\s*(?:ккал|kcal)\b/i
        ];

        for (const text of texts) {
            for (const pattern of patterns) {
                const match = text.match(pattern);
                const parsed = match ? validNutritionValue(parseDecimal(match[1]), 5000) : null;

                if (parsed != null)
                    return parsed;
            }
        }

        for (let index = 0; index < texts.length - 1; index++) {
            if (!/^(?:калорийность|энергетическая\s+ценность)(?:\s*[,;]?\s*(?:ккал|kcal))?$/i.test(texts[index]))
                continue;

            const parsed = validNutritionValue(parseDecimal(texts[index + 1]), 5000);

            if (parsed != null)
                return parsed;
        }

        return null;
    }

    function extractNutrition(node) {
        const result = { proteins: null, fats: null, carbs: null, calories: null, basis: "" };
        extractNutritionFromObjects(node, result);

        const texts = [];
        collectTexts(node, texts);
        const normalizedTexts = texts.map(normalizeText).filter(Boolean);

        if (result.proteins == null)
            result.proteins = extractNutritionValue(normalizedTexts, "белк(?:и|ов|а)?|proteins?", 1000);

        if (result.fats == null)
            result.fats = extractNutritionValue(normalizedTexts, "жир(?:ы|ов|а)?|fats?", 1000);

        if (result.carbs == null)
            result.carbs = extractNutritionValue(normalizedTexts, "углевод(?:ы|ов|а)?|carbohydrates?|carbs?", 1000);

        if (result.calories == null)
            result.calories = extractCalories(normalizedTexts);

        const basisText = normalizedTexts.find(text => /на\s*100\s*(?:г|мл)|100\s*(?:г|мл)/i.test(text)) || "";

        if (/100\s*мл/i.test(basisText))
            result.basis = "100 мл";
        else if (/100\s*г/i.test(basisText))
            result.basis = "100 г";
        else if (normalizedTexts.some(text => /на\s+порци(?:ю|и)/i.test(text)))
            result.basis = "порция";

        return Object.values(result).some((value, index) => index < 4 && value != null) ? result : null;
    }

    function parseProductDetails(value) {
        const response = parseJson(value);
        return response ? { validJson: true, nutrition: extractNutrition(response) } : { validJson: false, nutrition: null };
    }

    function extractEatSoon(item) {
        const texts = [];
        collectTexts(item, texts);
        return texts.some(containsEatSoon);
    }

    function normalizeCategoryCandidate(value) {
        const text = normalizeText(value);

        if (!text || /^\d+$/.test(text) || /^https?:\/\//i.test(text))
            return "";

        const parts = text.split(/\s*(?:>|→|\/|\|)\s*/).map(normalizeText).filter(Boolean);
        const candidate = parts.at(-1) || text;

        if (candidate.length < 3 || candidate.length > 80)
            return "";

        const generic = ["продукты", "продукты питания", "каталог", "ozon fresh", "fresh", "готовая еда"];
        return generic.includes(candidate.toLocaleLowerCase("ru-RU")) ? "" : candidate;
    }

    function extractOzonCategory(item) {
        const keyPattern = /^(?:category|categoryName|categoryTitle|categoryPath|category_name|category_title|category_path|catalogPath|catalog_path)$/i;
        const candidates = [];

        function visit(node, depth = 0) {
            if (!node || depth > 7)
                return;

            if (Array.isArray(node)) {
                for (const value of node)
                    visit(value, depth + 1);

                return;
            }

            if (typeof node !== "object")
                return;

            for (const [key, value] of Object.entries(node)) {
                if (keyPattern.test(key)) {
                    if (typeof value === "string") {
                        const parsed = parseJson(value);

                        if (parsed)
                            visit(parsed, depth + 1);
                        else
                            candidates.push(normalizeCategoryCandidate(value));
                    } else if (typeof value === "object") {
                        candidates.push(normalizeCategoryCandidate(value?.name || value?.title || value?.text));
                        visit(value, depth + 1);
                    }
                } else if (/analytics|tracking|metadata|meta/i.test(key)) {
                    const parsed = parseJson(value);
                    visit(parsed || value, depth + 1);
                } else if (typeof value === "object") {
                    visit(value, depth + 1);
                }
            }
        }

        visit(item);
        return candidates.filter(Boolean).sort((a, b) => a.length - b.length)[0] || "";
    }

    function classifyProductCategory(title) {
        const text = ` ${normalizeText(title).toLocaleLowerCase("ru-RU")} `;

        for (const [category, words] of CATEGORY_RULES) {
            if (words.some(word => text.includes(word)))
                return category;
        }

        return "Другое";
    }

    function parseProduct(item) {
        if (!item || typeof item !== "object")
            return null;

        const id = item.sku || item.id;
        const url = cleanProductUrl(item?.action?.link);
        const priceBlock = findMainState(item, "priceV2");
        const prices = priceBlock?.price || [];
        const currentPriceText = prices.find(x => x?.textStyle === "PRICE")?.text || prices[0]?.text;
        const price = parseMoney(currentPriceText);

        if (!id || !url.includes("/product/") || !price)
            return null;

        const oldPrice = parseMoney(prices.find(x => x?.textStyle === "ORIGINAL_PRICE")?.text);
        const explicitDiscount = parseInteger(priceBlock?.discount);
        const calculatedDiscount = oldPrice && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : 0;
        const image = item?.tileImage?.items?.find(x => x?.type === "image")?.image?.link || "";
        const title = normalizeText(findTitleState(item)?.text) || `Товар ${id}`;
        const { rating, reviewCount } = extractRating(item);
        const ozonCategory = extractOzonCategory(item);
        const classifiedCategory = classifyProductCategory(title);
        const nutrition = extractNutrition(item);

        return {
            id: String(id),
            title,
            price,
            oldPrice,
            discount: explicitDiscount || calculatedDiscount,
            rating,
            reviewCount,
            category: classifiedCategory !== "Другое" ? classifiedCategory : ozonCategory || "Другое",
            ozonCategory,
            eatSoon: extractEatSoon(item),
            nutrition,
            nutritionStatus: nutrition ? "loaded" : "idle",
            image,
            url
        };
    }

    function collectProducts(node, result, depth = 0) {
        if (!node || depth > 8)
            return;

        if (Array.isArray(node)) {
            for (const item of node) {
                const product = parseProduct(item);

                if (product)
                    result.set(product.id, product);
                else
                    collectProducts(item, result, depth + 1);
            }

            return;
        }

        if (typeof node !== "object")
            return;

        for (const value of Object.values(node))
            collectProducts(value, result, depth + 1);
    }

    function findNextPage(node, depth = 0) {
        if (!node || depth > 8)
            return null;

        if (Array.isArray(node)) {
            for (const item of node) {
                const found = findNextPage(item, depth + 1);

                if (found)
                    return found;
            }

            return null;
        }

        if (typeof node !== "object")
            return null;

        for (const [key, value] of Object.entries(node)) {
            if ((key === "nextPage" || key === "next_page") && typeof value === "string" && value.startsWith("/"))
                return value;
        }

        for (const value of Object.values(node)) {
            const found = findNextPage(value, depth + 1);

            if (found)
                return found;
        }

        return null;
    }

    function parseResponse(value) {
        const response = parseJson(value);

        if (!response)
            return { validJson: false, products: [], grids: [], nextPage: null };

        const layouts = Array.isArray(response.layout) ? response.layout : [];
        const grids = [];

        for (const layout of layouts) {
            const component = String(layout?.component || "").toLowerCase();
            const vertical = String(layout?.vertical || "").toLowerCase();

            if (!layout?.stateId || !component.includes("tilegrid") || vertical !== "products")
                continue;

            const params = parseJson(layout.params) || {};
            const widgetState = parseJson(response.widgetStates?.[layout.stateId]);
            const products = new Map();

            if (widgetState)
                collectProducts(widgetState.items || widgetState, products);

            grids.push({
                stateId: layout.stateId,
                component: layout.component,
                usePagination: params.usePagination === true,
                products: [...products.values()],
                productsCount: products.size
            });
        }

        grids.sort((a, b) => Number(b.usePagination) - Number(a.usePagination) || b.productsCount - a.productsCount);
        const primaryGrid = grids[0] || null;

        return {
            validJson: true,
            products: primaryGrid?.products || [],
            grids: grids.map(grid => ({
                stateId: grid.stateId,
                component: grid.component,
                usePagination: grid.usePagination,
                productsCount: grid.productsCount,
                selected: grid === primaryGrid
            })),
            nextPage: typeof response.nextPage === "string" ? response.nextPage : findNextPage(response)
        };
    }

    function parseInnerUrl(fullUrl) {
        try {
            const url = new URL(fullUrl, "https://www.ozon.ru");
            return url.searchParams.get("url") || "";
        } catch {
            return "";
        }
    }

    function getPageIndex(fullUrl) {
        try {
            const inner = parseInnerUrl(fullUrl);
            const url = new URL(inner || "/", "https://www.ozon.ru");
            const values = [url.searchParams.get("layout_page_index"), url.searchParams.get("page")]
                .map(Number).filter(Number.isFinite);
            return values.length ? Math.min(...values) : 999999;
        } catch {
            return 999999;
        }
    }

    globalThis.OzonFreshParser = {
        normalizeText,
        parseMoney,
        parseInteger,
        parseDecimal,
        parseJson,
        parseProduct,
        parseResponse,
        parseProductDetails,
        extractNutrition,
        parseInnerUrl,
        getPageIndex,
        extractRatingFromText,
        containsEatSoon,
        classifyProductCategory
    };
})();
