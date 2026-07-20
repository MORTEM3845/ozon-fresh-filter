(() => {
    if (window.__ozonFreshFilterLoaded)
        return;

    window.__ozonFreshFilterLoaded = true;

    const state = {
        products: new Map(), cardRefs: new Map(), scanning: false, stopRequested: false, step: 0, stableRounds: 0,
        initialScrollY: 0,
        rules: { maxPrice: 0, minDiscount: 0, greenWords: [], redWords: [], hideUnsuitable: true }
    };

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalizeText = value => (value || "").replace(/\s+/g, " ").trim();

    function parseNumber(value) {
        const result = Number(String(value || "").replace(/[^\d,.-]/g, "").replace(",", "."));
        return Number.isFinite(result) ? result : null;
    }

    function normalizeProductUrl(href) {
        try {
            const url = new URL(href, location.origin);
            url.search = "";
            url.hash = "";
            return url.toString();
        } catch {
            return "";
        }
    }

    function getProductId(url) {
        const match = url.match(/\/product\/[^/?#]*?-(\d+)\/?$/i) || url.match(/\/product\/.*?(\d{6,})(?:\/|$)/i);
        return match?.[1] || url;
    }

    function isVisible(element) {
        if (!element)
            return false;

        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }

    function findCardRoot(anchor) {
        const indexed = anchor.closest("[data-index]");
        if (indexed && normalizeText(indexed.innerText).includes("₽"))
            return indexed;

        let current = anchor;
        for (let depth = 0; depth < 8 && current && current !== document.body; depth++, current = current.parentElement) {
            const text = normalizeText(current.innerText);
            if (!text.includes("₽") || text.length < 20 || text.length > 2500)
                continue;

            if (current.querySelectorAll('a[href*="/product/"]').length <= 5)
                return current;
        }

        return anchor.parentElement;
    }

    function extractTitle(root, anchors) {
        const candidates = [];

        for (const anchor of anchors) {
            const text = normalizeText(anchor.innerText);
            if (text.length >= 8 && !/^\d[\d\s]*\s*₽/.test(text))
                candidates.push(text);
        }

        for (const element of root.querySelectorAll("span, div")) {
            const text = normalizeText(element.innerText);
            if (text.length >= 12 && text.length <= 300 && !text.includes("₽"))
                candidates.push(text);
        }

        candidates.sort((a, b) => {
            const aScore = (/[А-Яа-яA-Za-z]/.test(a) ? 1000 : 0) - Math.abs(a.length - 70);
            const bScore = (/[А-Яа-яA-Za-z]/.test(b) ? 1000 : 0) - Math.abs(b.length - 70);
            return bScore - aScore;
        });

        return candidates[0] || "Без названия";
    }

    function extractPrices(text) {
        const values = [...text.matchAll(/(\d[\d\s\u00a0]*)(?:[,.]\d{1,2})?\s*₽/g)]
            .map(match => parseNumber(match[1]))
            .filter(value => value !== null && value > 0);

        if (!values.length)
            return { price: null, oldPrice: null };

        const price = values[0];
        const oldPrice = values.slice(1).filter(value => value > price).sort((a, b) => b - a)[0] ?? null;
        return { price, oldPrice };
    }

    function extractDiscount(text, price, oldPrice) {
        // Только отрицательный процент является явной скидкой.
        // "Масло 82%" и "творог 5%" сюда больше не попадут.
        const explicit = [...text.matchAll(/(?:скидка\s*)?[−-]\s*(\d{1,2})\s*%/gi)]
            .map(match => Number(match[1]))
            .filter(value => value >= 1 && value <= 99)
            .sort((a, b) => b - a)[0];

        if (explicit)
            return explicit;

        return price && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : 0;
    }

    function extractProduct(anchor) {
        const url = normalizeProductUrl(anchor.href);
        if (!url || !url.includes("/product/"))
            return null;

        const root = findCardRoot(anchor);
        if (!root)
            return null;

        const text = normalizeText(root.innerText);
        const anchors = [...root.querySelectorAll('a[href*="/product/"]')];
        const title = extractTitle(root, anchors);
        const { price, oldPrice } = extractPrices(text);
        if (!price)
            return null;

        return {
            id: getProductId(url), title, url, price, oldPrice,
            discount: extractDiscount(text, price, oldPrice),
            image: root.querySelector("img")?.src || "",
            capturedAt: new Date().toISOString()
        };
    }

    function rememberCard(product, root) {
        let refs = state.cardRefs.get(product.id);
        if (!refs) {
            refs = new Set();
            state.cardRefs.set(product.id, refs);
        }
        refs.add(root);
    }

    function scanVisibleProducts() {
        let added = 0;

        for (const anchor of document.querySelectorAll('a[href*="/product/"]')) {
            const currentUrl = normalizeProductUrl(anchor.href);
            if (!currentUrl || anchor.dataset.ofScannedUrl === currentUrl)
                continue;

            anchor.dataset.ofScannedUrl = currentUrl;
            const product = extractProduct(anchor);
            if (!product)
                continue;

            rememberCard(product, findCardRoot(anchor));
            if (!state.products.has(product.id))
                added++;

            state.products.set(product.id, { ...state.products.get(product.id), ...product });
        }

        applyRulesToAllCards();
        return added;
    }

    function includesWord(text, word) {
        return normalizeText(text).toLocaleLowerCase("ru-RU").includes(word.toLocaleLowerCase("ru-RU"));
    }

    function evaluate(product) {
        const reasons = [];
        const greenMatches = state.rules.greenWords.filter(word => includesWord(product.title, word));
        const redMatches = state.rules.redWords.filter(word => includesWord(product.title, word));

        if (state.rules.maxPrice > 0 && product.price > state.rules.maxPrice)
            reasons.push(`цена ${product.price} ₽ выше ${state.rules.maxPrice} ₽`);
        if (state.rules.minDiscount > 0 && product.discount < state.rules.minDiscount)
            reasons.push(`скидка ${product.discount}% меньше ${state.rules.minDiscount}%`);
        if (redMatches.length)
            reasons.push(`красные слова: ${redMatches.join(", ")}`);

        return { suitable: reasons.length === 0, score: product.discount + greenMatches.length * 20, reasons, greenMatches, redMatches };
    }

    function removeMarks(root) {
        if (!root)
            return;
        root.classList.remove("of-good", "of-bad", "of-hidden");
        root.querySelectorAll(":scope > .of-badge").forEach(x => x.remove());
    }

    function applyRulesToCard(product, root) {
        if (!root?.isConnected)
            return;

        removeMarks(root);
        const result = evaluate(product);
        root.classList.add(result.suitable ? "of-good" : "of-bad");
        if (!result.suitable && state.rules.hideUnsuitable && !state.scanning)
            root.classList.add("of-hidden");

        const badge = document.createElement("div");
        badge.className = "of-badge";
        badge.textContent = result.suitable ? `✓ ${product.discount}% · ${result.score}` : `✕ ${result.reasons[0]}`;
        badge.title = result.suitable ? `Подходит. Оценка: ${result.score}` : result.reasons.join("\n");
        root.style.position = root.style.position || "relative";
        root.appendChild(badge);
    }

    function applyRulesToAllCards() {
        for (const [id, refs] of state.cardRefs) {
            const product = state.products.get(id);
            if (!product)
                continue;
            for (const root of refs)
                applyRulesToCard(product, root);
        }
    }

    function clickLoadMoreButton() {
        const button = [...document.querySelectorAll("button")]
            .find(x => isVisible(x) && /показать\s+ещ[её]|загрузить\s+ещ[её]/i.test(normalizeText(x.innerText)));
        if (!button)
            return false;
        button.click();
        return true;
    }

    function getSnapshot() {
        return {
            products: [...state.products.values()].map(product => ({ ...product, ...evaluate(product) })),
            scanning: state.scanning, step: state.step, stableRounds: state.stableRounds,
            scrollY: Math.round(window.scrollY), pageHeight: document.documentElement.scrollHeight
        };
    }

    function publishProgress() {
        chrome.runtime.sendMessage({ type: "OZON_SCAN_PROGRESS", payload: getSnapshot() }).catch(() => {});
    }

    async function startScan() {
        if (state.scanning)
            return;

        state.scanning = true;
        state.stopRequested = false;
        state.step = 0;
        state.stableRounds = 0;
        state.initialScrollY = window.scrollY;

        const oldScrollBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = "auto";
        let lastCount = -1;
        let lastHeight = -1;

        try {
            for (let step = 1; step <= 150 && !state.stopRequested; step++) {
                state.step = step;
                scanVisibleProducts();

                if (clickLoadMoreButton())
                    await sleep(250);

                const heightBefore = document.documentElement.scrollHeight;
                window.scrollTo(0, heightBefore);
                await sleep(300);
                scanVisibleProducts();

                const currentCount = state.products.size;
                const currentHeight = document.documentElement.scrollHeight;
                state.stableRounds = currentCount === lastCount && currentHeight === lastHeight
                    ? state.stableRounds + 1
                    : 0;

                publishProgress();
                if (state.stableRounds >= 4)
                    break;

                lastCount = currentCount;
                lastHeight = currentHeight;
            }
        } finally {
            state.scanning = false;
            document.documentElement.style.scrollBehavior = oldScrollBehavior;
            applyRulesToAllCards();
            publishProgress();
            window.scrollTo(0, state.initialScrollY);
        }
    }

    function clearData() {
        state.products.clear();
        for (const refs of state.cardRefs.values())
            for (const root of refs)
                removeMarks(root);
        state.cardRefs.clear();
        publishProgress();
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "OZON_GET_STATE") {
            scanVisibleProducts();
            sendResponse(getSnapshot());
        } else if (message?.type === "OZON_START_SCAN") {
            startScan();
            sendResponse({ ok: true });
        } else if (message?.type === "OZON_STOP_SCAN") {
            state.stopRequested = true;
            sendResponse({ ok: true });
        } else if (message?.type === "OZON_APPLY_RULES") {
            state.rules = { ...state.rules, ...message.payload };
            applyRulesToAllCards();
            sendResponse(getSnapshot());
        } else if (message?.type === "OZON_CLEAR_DATA") {
            clearData();
            sendResponse({ ok: true });
        }
    });

    const observer = new MutationObserver(() => {
        if (!state.scanning)
            return;
        clearTimeout(observer.timer);
        observer.timer = setTimeout(scanVisibleProducts, 250);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanVisibleProducts();
    publishProgress();
})();
