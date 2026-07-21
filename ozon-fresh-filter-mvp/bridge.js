(() => {
    if (window.__ozonFreshBridgeInstalled)
        return;

    window.__ozonFreshBridgeInstalled = true;

    const Parser = globalThis.OzonFreshParser;
    const EVENT_TYPE = "OZON_FRESH_PAGE_EVENT";
    const COMMAND_TYPE = "OZON_FRESH_PAGE_COMMAND";

    const state = {
        products: new Map(),
        candidates: new Map(),
        resourceUrls: new Set(),

        scanning: false,
        stopRequested: false,
        interceptorReady: false,

        phase: "idle",
        pagesFetched: 0,
        domCount: 0,
        apiCount: 0,
        candidateCount: 0,

        selectedCandidateUrl: "",
        lastError: "",

        rules: {
            maxPrice: 0,
            minDiscount: 0,
            greenWords: [],
            redWords: [],
            hideUnsuitable: true,
            includeDomPage: true,
            pageLimit: 100,
            scrollWaitMs: 2500
        }
    };

    let scrollFinishedAt = 0;

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitFor(predicate, timeoutMs, intervalMs = 100) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            if (predicate())
                return true;

            await delay(intervalMs);
        }

        return false;
    }

    function sendPageCommand(command) {
        window.postMessage({
            type: COMMAND_TYPE,
            command
        }, "*");
    }

    function normalizeWords(value) {
        return Array.isArray(value)
            ? value.map(x => Parser.normalizeText(x)).filter(Boolean)
            : [];
    }

    function mergeProducts(products, source) {
        let added = 0;

        for (const product of products || []) {
            if (!product?.id)
                continue;

            const previous = state.products.get(product.id);

            if (!previous)
                added++;

            state.products.set(product.id, {
                ...previous,
                ...product,
                source: previous?.source === "api" ? "api" : source
            });
        }

        return added;
    }

    function includesWord(text, word) {
        return Parser.normalizeText(text)
            .toLocaleLowerCase("ru-RU")
            .includes(Parser.normalizeText(word).toLocaleLowerCase("ru-RU"));
    }

    function evaluate(product) {
        const reasons = [];

        const greenMatches = state.rules.greenWords
            .filter(word => includesWord(product.title, word));

        const redMatches = state.rules.redWords
            .filter(word => includesWord(product.title, word));

        if (state.rules.maxPrice > 0 && product.price > state.rules.maxPrice)
            reasons.push(`цена ${product.price} ₽ выше ${state.rules.maxPrice} ₽`);

        if (state.rules.minDiscount > 0 && product.discount < state.rules.minDiscount)
            reasons.push(`скидка ${product.discount}% меньше ${state.rules.minDiscount}%`);

        if (redMatches.length)
            reasons.push(`красные слова: ${redMatches.join(", ")}`);

        const saving = product.oldPrice && product.oldPrice > product.price
            ? product.oldPrice - product.price
            : 0;

        return {
            suitable: reasons.length === 0,
            score: product.discount * 10 + greenMatches.length * 100 - product.price / 100,
            saving,
            reasons,
            greenMatches,
            redMatches
        };
    }

    function getSnapshot() {
        const products = [...state.products.values()]
            .map(product => ({
                ...product,
                ...evaluate(product)
            }));

        return {
            products,
            productCount: products.length,
            scanning: state.scanning,
            phase: state.phase,
            pagesFetched: state.pagesFetched,
            domCount: state.domCount,
            apiCount: state.apiCount,
            candidateCount: state.candidates.size,
            selectedCandidateUrl: state.selectedCandidateUrl,
            interceptorReady: state.interceptorReady,
            lastError: state.lastError,
            pageUrl: location.href
        };
    }

    function publishProgress() {
        chrome.runtime.sendMessage({
            type: "OZON_FRESH_PROGRESS",
            payload: getSnapshot()
        }).catch(() => {});
    }

    function scoreCandidate(url, parsed) {
        let score = parsed.products.length * 20;

        if (parsed.nextPage)
            score += 500;

        if (parsed.grids.length)
            score += 100;

        try {
            const innerUrl = Parser.parseInnerUrl(url);
            const innerPath = new URL(innerUrl || "/", location.origin).pathname;

            if (innerPath === location.pathname)
                score += 1000;
            else if (innerPath.includes(location.pathname))
                score += 500;

            if (innerPath.includes("searchSuggestions"))
                score -= 2000;
        } catch {
            // Не влияет на оценку.
        }

        const pageIndex = Parser.getPageIndex(url);

        if (pageIndex < 999999)
            score += Math.max(0, 200 - pageIndex);

        return score;
    }

    function recordCandidate(event) {
        if (!event.url || !event.body)
            return null;

        const parsed = Parser.parseResponse(event.body);

        if (!parsed.validJson)
            return null;

        const existing = state.candidates.get(event.url);

        const candidate = {
            url: event.url,
            source: event.source,
            status: event.status || 0,
            products: parsed.products,
            productsCount: parsed.products.length,
            grids: parsed.grids,
            nextPage: parsed.nextPage,
            score: scoreCandidate(event.url, parsed),
            firstSeenAt: existing?.firstSeenAt || Date.now()
        };

        state.candidates.set(event.url, candidate);
        state.candidateCount = state.candidates.size;

        return candidate;
    }

    function chooseBestCandidate() {
        return [...state.candidates.values()]
            .filter(candidate =>
                candidate.productsCount > 0 &&
                candidate.status >= 200 &&
                candidate.status < 300
            )
            .sort((a, b) =>
                b.score - a.score ||
                a.firstSeenAt - b.firstSeenAt
            )[0] || null;
    }

    function scoreResourceUrl(url) {
        let score = 0;

        try {
            const innerUrl = Parser.parseInnerUrl(url);
            const innerPath = new URL(innerUrl || "/", location.origin).pathname;

            if (innerPath === location.pathname)
                score += 1000;
            else if (innerPath.includes(location.pathname))
                score += 500;

            if (innerPath.includes("searchSuggestions"))
                score -= 2000;
        } catch {
            return -10000;
        }

        const pageIndex = Parser.getPageIndex(url);

        if (pageIndex < 999999)
            score += Math.max(0, 200 - pageIndex);

        return score;
    }

    function chooseBestResourceUrl() {
        return [...state.resourceUrls]
            .sort((a, b) => scoreResourceUrl(b) - scoreResourceUrl(a))[0] || "";
    }

    function findMainGridContainer() {
        const selectors = [
            '[data-widget*="tileGrid"]',
            '[data-widget*="searchResults"]',
            '[data-widget*="catalogResults"]'
        ];

        const candidates = [...document.querySelectorAll(selectors.join(","))]
            .map(element => ({
                element,
                count: new Set(
                    [...element.querySelectorAll('a[href*="/product/"]')]
                        .map(x => x.href)
                ).size
            }))
            .filter(x => x.count >= 4)
            .sort((a, b) => b.count - a.count);

        if (candidates.length)
            return candidates[0].element;

        const anchors = [...document.querySelectorAll('a[href*="/product/"]')];
        const ancestorScores = new Map();

        for (const anchor of anchors.slice(0, 120)) {
            let current = anchor.parentElement;

            for (let depth = 0; depth < 8 && current && current !== document.body; depth++) {
                const count = current.querySelectorAll('a[href*="/product/"]').length;

                if (count >= 4 && count <= 150) {
                    const previous = ancestorScores.get(current) || 0;
                    ancestorScores.set(current, Math.max(previous, count * 10 - depth));
                }

                current = current.parentElement;
            }
        }

        return [...ancestorScores.entries()]
            .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }

    function findCardRoot(anchor, grid) {
        const indexed = anchor.closest("[data-index]");

        if (indexed && grid.contains(indexed))
            return indexed;

        let current = anchor;

        for (let depth = 0; depth < 8 && current && current !== grid; depth++) {
            const text = Parser.normalizeText(current.innerText);
            const productLinks = current.querySelectorAll('a[href*="/product/"]').length;

            if (text.includes("₽") && productLinks >= 1 && productLinks <= 4)
                return current;

            current = current.parentElement;
        }

        return anchor.parentElement;
    }

    function parseDomProduct(anchor, grid) {
        try {
            const url = new URL(anchor.href, location.origin);
            const idMatch = url.pathname.match(/-(\d+)\/?$/);

            if (!idMatch)
                return null;

            const root = findCardRoot(anchor, grid);

            if (!root)
                return null;

            const rawText = root.innerText || "";

            const prices = [...rawText.matchAll(/(\d[\d\s\u00a0]*)\s*₽/g)]
                .map(match => Parser.parseMoney(match[1]))
                .filter(value => value > 0);

            if (!prices.length)
                return null;

            const price = prices[0];
            const oldPrice = prices.slice(1).find(value => value > price) || null;

            // Только явно написанный минус перед процентом является скидкой.
            const discountMatch = rawText.match(/[−–-]\s*(\d{1,2})\s*%/);

            const discount = discountMatch
                ? Number(discountMatch[1])
                : oldPrice ? Math.round((1 - price / oldPrice) * 100) : 0;

            const lines = rawText
                .split(/\n+/)
                .map(Parser.normalizeText)
                .filter(line =>
                    line.length >= 8 &&
                    line.length <= 300 &&
                    !line.includes("₽") &&
                    !/^[−–-]?\d+\s*%$/.test(line) &&
                    !/^\d(?:[.,]\d)?$/.test(line)
                );

            const anchorText = Parser.normalizeText(anchor.innerText);

            const titleCandidates = [
                anchorText,
                ...lines
            ].filter(Boolean);

            titleCandidates.sort((a, b) => b.length - a.length);

            url.searchParams.delete("at");
            url.hash = "";

            return {
                id: idMatch[1],
                title: titleCandidates[0] || `Товар ${idMatch[1]}`,
                price,
                oldPrice,
                discount,
                rating: null,
                reviewCount: 0,
                image: root.querySelector("img")?.src || "",
                url: url.toString()
            };
        } catch {
            return null;
        }
    }

    function captureMainGridProducts() {
        const grid = findMainGridContainer();

        if (!grid)
            return [];

        const products = new Map();

        for (const anchor of grid.querySelectorAll('a[href*="/product/"]')) {
            const product = parseDomProduct(anchor, grid);

            if (product)
                products.set(product.id, product);
        }

        return [...products.values()];
    }

    async function startScan() {
        if (state.scanning)
            return;

        if (!state.interceptorReady) {
            state.lastError =
                "Перехватчик ещё не установлен. Обнови вкладку Ozon через Ctrl + Shift + R.";

            state.phase = "error";
            publishProgress();
            return;
        }

        state.products.clear();
        state.candidates.clear();
        state.resourceUrls.clear();

        state.scanning = true;
        state.stopRequested = false;
        state.phase = "starting";
        state.pagesFetched = 0;
        state.domCount = 0;
        state.apiCount = 0;
        state.candidateCount = 0;
        state.selectedCandidateUrl = "";
        state.lastError = "";

        publishProgress();

        try {
            if (state.rules.includeDomPage) {
                state.phase = "dom";
                publishProgress();

                const domProducts = captureMainGridProducts();

                state.domCount += mergeProducts(domProducts, "dom");
                publishProgress();
            }

            state.phase = "capturing";
            publishProgress();

            sendPageCommand({
                name: "snapshot-performance"
            });

            await delay(300);

            state.phase = "technical-scroll";
            scrollFinishedAt = 0;
            publishProgress();

            sendPageCommand({
                name: "technical-scroll",
                waitMs: state.rules.scrollWaitMs
            });

            await waitFor(
                () => scrollFinishedAt > 0 || state.stopRequested,
                state.rules.scrollWaitMs + 5000
            );

            if (state.stopRequested)
                return;

            if (state.rules.includeDomPage) {
                const domProducts = captureMainGridProducts();
                state.domCount += mergeProducts(domProducts, "dom");
                publishProgress();
            }

            await delay(600);

            let candidate = chooseBestCandidate();

            if (!candidate) {
                const capturedUrl = chooseBestResourceUrl();

                if (capturedUrl) {
                    state.phase = "fetching-captured-url";
                    publishProgress();

                    sendPageCommand({
                        name: "fetch-captured-url",
                        url: capturedUrl
                    });

                    await waitFor(
                        () => Boolean(chooseBestCandidate()) || state.stopRequested,
                        7000
                    );

                    candidate = chooseBestCandidate();
                }
            }

            if (!candidate)
                throw new Error("Не удалось найти API-ответ с основным product grid");

            state.selectedCandidateUrl = candidate.url;
            state.phase = "candidate-selected";

            state.apiCount += mergeProducts(candidate.products, "api");

            publishProgress();

            if (!candidate.nextPage) {
                state.scanning = false;
                state.phase = "finished";
                publishProgress();
                return;
            }

            state.phase = "chain";
            publishProgress();

            sendPageCommand({
                name: "start-chain",
                firstPageUrl: candidate.nextPage,
                limit: state.rules.pageLimit
            });
        } catch (error) {
            state.scanning = false;
            state.phase = "error";
            state.lastError = error?.message || String(error);
            publishProgress();
        }
    }

    function stopScan() {
        state.stopRequested = true;
        state.scanning = false;
        state.phase = "stopped";

        sendPageCommand({
            name: "stop-chain"
        });

        publishProgress();
    }

    function clearData() {
        stopScan();

        state.products.clear();
        state.candidates.clear();
        state.resourceUrls.clear();

        state.stopRequested = false;
        state.phase = "idle";
        state.pagesFetched = 0;
        state.domCount = 0;
        state.apiCount = 0;
        state.candidateCount = 0;
        state.selectedCandidateUrl = "";
        state.lastError = "";

        publishProgress();
    }

    window.addEventListener("message", event => {
        if (event.source !== window || event.data?.type !== EVENT_TYPE)
            return;

        const pageEvent = event.data.event || {};

        if (pageEvent.kind === "interceptor-ready") {
            state.interceptorReady = true;
            publishProgress();
            return;
        }

        if (pageEvent.kind === "resource" || pageEvent.kind === "request") {
            if (pageEvent.url)
                state.resourceUrls.add(pageEvent.url);

            return;
        }

        if (pageEvent.kind === "response" ||
            pageEvent.kind === "captured-response") {
            recordCandidate(pageEvent);
            publishProgress();
            return;
        }

        if (pageEvent.kind === "technical-scroll-finished") {
            scrollFinishedAt = Date.now();
            return;
        }

        if (pageEvent.kind === "chain-response") {
            const parsed = Parser.parseResponse(pageEvent.body);

            if (!parsed.validJson)
                return;

            const added = mergeProducts(parsed.products, "api");

            state.pagesFetched++;
            state.apiCount += added;
            state.phase = "chain";

            publishProgress();
            return;
        }

        if (pageEvent.kind === "chain-error") {
            state.lastError = pageEvent.message || "Ошибка API-цепочки";
            return;
        }

        if (pageEvent.kind === "chain-finished") {
            state.scanning = false;
            state.phase = pageEvent.stopped ? "stopped" : "finished";
            publishProgress();
        }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message.type !== "string")
            return;

        if (message.type === "OZON_FRESH_GET_STATE") {
            sendResponse(getSnapshot());
            return;
        }

        if (message.type === "OZON_FRESH_START") {
            startScan();
            sendResponse({ ok: true });
            return;
        }

        if (message.type === "OZON_FRESH_STOP") {
            stopScan();
            sendResponse({ ok: true });
            return;
        }

        if (message.type === "OZON_FRESH_CLEAR") {
            clearData();
            sendResponse({ ok: true });
            return;
        }

        if (message.type === "OZON_FRESH_APPLY_RULES") {
            state.rules = {
                ...state.rules,
                ...message.payload,
                greenWords: normalizeWords(message.payload?.greenWords),
                redWords: normalizeWords(message.payload?.redWords),
                pageLimit: Math.max(
                    1,
                    Math.min(200, Number(message.payload?.pageLimit) || 100)
                ),
                scrollWaitMs: Math.max(
                    500,
                    Math.min(10000, Number(message.payload?.scrollWaitMs) || 2500)
                )
            };

            sendResponse(getSnapshot());
        }
    });

    chrome.runtime.sendMessage({
        type: "OZON_FRESH_BRIDGE_READY",
        pageUrl: location.href
    }).catch(() => {});
})();