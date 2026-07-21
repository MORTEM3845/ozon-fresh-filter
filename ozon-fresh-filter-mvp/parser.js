(() => {
    "use strict";

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

    function extractRating(item) {
        const label = findMainState(item, "labelListV2");

        const texts = (label?.items || [])
            .filter(x => x?.type === "text")
            .map(x => normalizeText(x?.text?.text));

        const ratingText = texts.find(x => /^[0-5](?:[.,]\d)$/.test(x));
        const ratingIndex = ratingText ? texts.indexOf(ratingText) : -1;
        const reviewsText = texts.slice(ratingIndex + 1).find(x => /\d/.test(x));

        return {
            rating: ratingText ? Number(ratingText.replace(",", ".")) : null,
            reviewCount: parseInteger(reviewsText)
        };
    }

    function parseProduct(item) {
        if (!item || typeof item !== "object")
            return null;

        const id = item.sku || item.id;
        const url = cleanProductUrl(item?.action?.link);
        const priceBlock = findMainState(item, "priceV2");
        const prices = priceBlock?.price || [];

        const currentPriceText =
            prices.find(x => x?.textStyle === "PRICE")?.text ||
            prices[0]?.text;

        const price = parseMoney(currentPriceText);

        if (!id || !url.includes("/product/") || !price)
            return null;

        const oldPrice = parseMoney(
            prices.find(x => x?.textStyle === "ORIGINAL_PRICE")?.text
        );

        // Скидка берётся только из специального поля JSON.
        // Процент жирности, белка и прочие проценты из названия сюда не попадут.
        const explicitDiscount = parseInteger(priceBlock?.discount);

        const calculatedDiscount = oldPrice && oldPrice > price
            ? Math.round((1 - price / oldPrice) * 100)
            : 0;

        const image = item?.tileImage?.items
            ?.find(x => x?.type === "image")
            ?.image?.link || "";

        const { rating, reviewCount } = extractRating(item);

        return {
            id: String(id),
            title: normalizeText(findTitleState(item)?.text) || `Товар ${id}`,
            price,
            oldPrice,
            discount: explicitDiscount || calculatedDiscount,
            rating,
            reviewCount,
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
            if ((key === "nextPage" || key === "next_page") &&
                typeof value === "string" &&
                value.startsWith("/")) {
                return value;
            }
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

        if (!response) {
            return {
                validJson: false,
                products: [],
                grids: [],
                nextPage: null
            };
        }

        const layouts = Array.isArray(response.layout) ? response.layout : [];
        const grids = [];

        for (const layout of layouts) {
            const component = String(layout?.component || "").toLowerCase();
            const vertical = String(layout?.vertical || "").toLowerCase();

            if (!layout?.stateId ||
                !component.includes("tilegrid") ||
                vertical !== "products") {
                continue;
            }

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

        grids.sort((a, b) =>
            Number(b.usePagination) - Number(a.usePagination) ||
            b.productsCount - a.productsCount
        );

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
            nextPage: typeof response.nextPage === "string"
                ? response.nextPage
                : findNextPage(response)
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

            const values = [
                url.searchParams.get("layout_page_index"),
                url.searchParams.get("page")
            ].map(Number).filter(Number.isFinite);

            return values.length ? Math.min(...values) : 999999;
        } catch {
            return 999999;
        }
    }

    globalThis.OzonFreshParser = {
        normalizeText,
        parseMoney,
        parseInteger,
        parseJson,
        parseProduct,
        parseResponse,
        parseInnerUrl,
        getPageIndex
    };
})();