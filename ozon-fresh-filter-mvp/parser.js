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
        const normalized = String(value || "").replace(/,/g, ".");
        const match = normalized.match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
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

    function extractWeightGrams(value) {
        const text = normalizeText(value).toLocaleLowerCase("ru-RU");

        if (!text)
            return null;

        const kgMatch = text.match(/(\d+(?:[.,]\d+)?)\s*кг\b/);

        if (kgMatch)
            return Math.round(parseDecimal(kgMatch[1]) * 1000);

        const gramMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:г|гр)\b/);

        if (gramMatch)
            return Math.round(parseDecimal(gramMatch[1]));

        return null;
    }

    function normalizeNutrition(details) {
        if (!details || typeof details !== "object")
            return null;

        const result = {
            protein: parseDecimal(details.protein),
            fat: parseDecimal(details.fat),
            carbs: parseDecimal(details.carbs),
            calories: parseDecimal(details.calories)
        };

        return Object.values(result).some(x => Number.isFinite(x)) ? result : null;
    }

    function extractNutritionFromText(value) {
        const text = normalizeText(value);

        if (!text)
            return null;

        const result = {
            protein: parseDecimal(text.match(/белк[аи]?[^\d]{0,24}(\d+(?:[.,]\d+)?)/i)?.[1]),
            fat: parseDecimal(text.match(/жир[аы]?[^\d]{0,24}(\d+(?:[.,]\d+)?)/i)?.[1]),
            carbs: parseDecimal(text.match(/углевод[аыов]*[^\d]{0,24}(\d+(?:[.,]\d+)?)/i)?.[1]),
            calories: parseDecimal(text.match(/(?:калори(?:йность|и)|ккал|энергетическ(?:ая|ой)\s+ценност[ьи])[^\d]{0,24}(\d+(?:[.,]\d+)?)/i)?.[1])
        };

        return Object.values(result).some(x => Number.isFinite(x)) ? result : null;
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
        const weightGrams = extractWeightGrams(title);

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
            weightGrams,
            gramsPerRub: weightGrams && price ? Number((weightGrams / price).toFixed(3)) : null,
            nutrition: null,
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
        cleanProductUrl,
        parseProduct,
        parseResponse,
        parseInnerUrl,
        getPageIndex,
        extractRatingFromText,
        containsEatSoon,
        classifyProductCategory,
        extractWeightGrams,
        extractNutritionFromText,
        normalizeNutrition
    };
})();
