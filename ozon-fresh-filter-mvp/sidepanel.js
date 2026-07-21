const panelParams = new URLSearchParams(location.search);
let boundTabId = Number(panelParams.get("tabId")) || null;

const elements = {
    status: document.getElementById("status"),

    startButton: document.getElementById("startButton"),
    stopButton: document.getElementById("stopButton"),
    clearButton: document.getElementById("clearButton"),

    maxPrice: document.getElementById("maxPrice"),
    minDiscount: document.getElementById("minDiscount"),
    greenWords: document.getElementById("greenWords"),
    redWords: document.getElementById("redWords"),
    hideUnsuitable: document.getElementById("hideUnsuitable"),

    includeDomPage: document.getElementById("includeDomPage"),
    pageLimit: document.getElementById("pageLimit"),
    scrollWaitMs: document.getElementById("scrollWaitMs"),

    totalCount: document.getElementById("totalCount"),
    suitableCount: document.getElementById("suitableCount"),
    hiddenCount: document.getElementById("hiddenCount"),
    pagesCount: document.getElementById("pagesCount"),

    sortMode: document.getElementById("sortMode"),
    exportButton: document.getElementById("exportButton"),
    productList: document.getElementById("productList"),

    interceptorState: document.getElementById("interceptorState"),
    candidateCount: document.getElementById("candidateCount"),
    domCount: document.getElementById("domCount"),
    apiCount: document.getElementById("apiCount"),
    selectedUrl: document.getElementById("selectedUrl")
};

let currentState = {
    products: [],
    productCount: 0,
    scanning: false,
    phase: "idle",
    pagesFetched: 0,
    domCount: 0,
    apiCount: 0,
    candidateCount: 0,
    interceptorReady: false,
    selectedCandidateUrl: "",
    lastError: ""
};

let applyTimer = null;

function parseWords(value) {
    return String(value || "")
        .split(/[,;\n]/)
        .map(x => x.trim())
        .filter(Boolean);
}

function getRules() {
    return {
        maxPrice: Number(elements.maxPrice.value) || 0,
        minDiscount: Number(elements.minDiscount.value) || 0,
        greenWords: parseWords(elements.greenWords.value),
        redWords: parseWords(elements.redWords.value),
        hideUnsuitable: elements.hideUnsuitable.checked,
        includeDomPage: elements.includeDomPage.checked,
        pageLimit: Number(elements.pageLimit.value) || 100,
        scrollWaitMs: Number(elements.scrollWaitMs.value) || 2500
    };
}

async function resolveBoundTab() {
    if (boundTabId) {
        try {
            return await chrome.tabs.get(boundTabId);
        } catch {
            boundTabId = null;
        }
    }

    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    const tab = tabs[0] || null;
    boundTabId = tab?.id || null;

    return tab;
}

async function sendToContent(type, payload = null) {
    const tab = await resolveBoundTab();

    if (!tab?.id || !tab.url?.startsWith("https://www.ozon.ru/"))
        throw new Error("Панель не привязана к вкладке Ozon");

    try {
        return await chrome.tabs.sendMessage(tab.id, {
            type,
            payload
        });
    } catch {
        throw new Error(
            "Не найден код расширения на странице. Обнови вкладку Ozon через Ctrl + Shift + R"
        );
    }
}

async function loadSettings() {
    const result = await chrome.storage.local.get("ozonFreshFilterRules");
    const rules = result.ozonFreshFilterRules || {};

    elements.maxPrice.value = rules.maxPrice || "";
    elements.minDiscount.value = rules.minDiscount || 0;
    elements.greenWords.value = (rules.greenWords || []).join(", ");
    elements.redWords.value = (rules.redWords || []).join(", ");

    elements.hideUnsuitable.checked = rules.hideUnsuitable !== false;
    elements.includeDomPage.checked = rules.includeDomPage !== false;
    elements.pageLimit.value = rules.pageLimit || 100;
    elements.scrollWaitMs.value = rules.scrollWaitMs || 2500;
}

async function saveAndApplyRules() {
    const rules = getRules();

    await chrome.storage.local.set({
        ozonFreshFilterRules: rules
    });

    currentState = await sendToContent("OZON_FRESH_APPLY_RULES", rules);
    render();
}

function scheduleApplyRules() {
    clearTimeout(applyTimer);

    applyTimer = setTimeout(() => {
        saveAndApplyRules().catch(error => {
            setStatus(error.message, true);
        });
    }, 250);
}

function setStatus(text, error = false, success = false) {
    elements.status.textContent = text;
    elements.status.classList.toggle("error", error);
    elements.status.classList.toggle("success", success);
}

function getAllProducts() {
    return [...(currentState.products || [])];
}

function getVisibleProducts() {
    const allProducts = getAllProducts();

    const products = elements.hideUnsuitable.checked
        ? allProducts.filter(x => x.suitable)
        : allProducts;

    const mode = elements.sortMode.value;

    if (mode === "discount") {
        products.sort((a, b) =>
            b.discount - a.discount ||
            a.price - b.price
        );
    } else if (mode === "priceAsc") {
        products.sort((a, b) =>
            a.price - b.price ||
            b.discount - a.discount
        );
    } else if (mode === "priceDesc") {
        products.sort((a, b) =>
            b.price - a.price ||
            b.discount - a.discount
        );
    } else if (mode === "saving") {
        products.sort((a, b) =>
            b.saving - a.saving ||
            b.discount - a.discount ||
            a.price - b.price
        );
    } else {
        products.sort((a, b) =>
            Number(b.suitable) - Number(a.suitable) ||
            b.score - a.score ||
            a.price - b.price
        );
    }

    return products;
}

function sourceTitle(source) {
    return source === "api" ? "API" : "страница";
}

function createProductElement(product) {
    const root = document.createElement("article");

    root.className = `product${product.suitable ? "" : " unsuitable"}`;
    root.title = "Открыть товар";

    root.addEventListener("click", () => {
        chrome.tabs.create({
            url: product.url,
            active: true
        });
    });

    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";

    if (product.image)
        image.src = product.image;

    const body = document.createElement("div");

    const title = document.createElement("div");
    title.className = "product-title";
    title.textContent = product.title;

    const meta = document.createElement("div");
    meta.className = "product-meta";

    const price = document.createElement("span");
    price.className = "price";
    price.textContent = `${product.price} ₽`;

    meta.appendChild(price);

    if (product.oldPrice) {
        const oldPrice = document.createElement("span");

        oldPrice.className = "old-price";
        oldPrice.textContent = `${product.oldPrice} ₽`;

        meta.appendChild(oldPrice);
    }

    const discount = document.createElement("span");

    discount.className = "discount";
    discount.textContent = product.discount
        ? `−${product.discount}%`
        : "без скидки";

    meta.appendChild(discount);

    if (product.rating) {
        const rating = document.createElement("span");
        rating.textContent = `★ ${product.rating}`;

        meta.appendChild(rating);
    }

    const source = document.createElement("span");

    source.className = "source";
    source.textContent = sourceTitle(product.source);

    meta.appendChild(source);

    body.append(title, meta);

    if (!product.suitable) {
        const reason = document.createElement("div");

        reason.className = "reason";
        reason.textContent = (product.reasons || []).join("; ");

        body.appendChild(reason);
    } else if (product.greenMatches?.length) {
        const match = document.createElement("div");

        match.className = "green-match";
        match.textContent = `Совпало: ${product.greenMatches.join(", ")}`;

        body.appendChild(match);
    }

    root.append(image, body);

    return root;
}

function renderStatus(total) {
    if (currentState.lastError) {
        setStatus(currentState.lastError, true);
        return;
    }

    if (!currentState.interceptorReady) {
        setStatus("Обнови вкладку Ozon через Ctrl + Shift + R", true);
        return;
    }

    const phase = currentState.phase;

    if (phase === "starting") {
        setStatus("Подготавливаю сбор товаров…");
    } else if (phase === "dom") {
        setStatus(`Получаю первую видимую страницу. Найдено: ${total}`);
    } else if (phase === "capturing") {
        setStatus(`Ищу внутренний запрос Ozon. Найдено: ${total}`);
    } else if (phase === "technical-scroll") {
        setStatus(`Провоцирую загрузку следующей пачки. Найдено: ${total}`);
    } else if (phase === "fetching-captured-url") {
        setStatus("Повторно запрашиваю пойманный URL…");
    } else if (phase === "candidate-selected") {
        setStatus(`API-запрос найден. Товаров: ${total}`);
    } else if (phase === "chain") {
        setStatus(
            `Получаю API-страницу ${currentState.pagesFetched + 1}. ` +
            `Уже найдено: ${total}`
        );
    } else if (phase === "finished") {
        setStatus(
            `Готово. API-страниц: ${currentState.pagesFetched}, товаров: ${total}`,
            false,
            true
        );
    } else if (phase === "stopped") {
        setStatus(`Сбор остановлен. Найдено товаров: ${total}`);
    } else {
        setStatus("Нажми «Собрать товары»");
    }
}

function render() {
    const allProducts = getAllProducts();
    const suitable = allProducts.filter(x => x.suitable).length;
    const total = allProducts.length;

    elements.totalCount.textContent = total;
    elements.suitableCount.textContent = suitable;
    elements.hiddenCount.textContent = total - suitable;
    elements.pagesCount.textContent = currentState.pagesFetched || 0;

    elements.startButton.disabled = currentState.scanning;
    elements.stopButton.disabled = !currentState.scanning;

    elements.interceptorState.textContent =
        currentState.interceptorReady ? "готов" : "не найден";

    elements.candidateCount.textContent = currentState.candidateCount || 0;
    elements.domCount.textContent = currentState.domCount || 0;
    elements.apiCount.textContent = currentState.apiCount || 0;
    elements.selectedUrl.textContent = currentState.selectedCandidateUrl || "";

    renderStatus(total);

    const products = getVisibleProducts();
    const displayLimit = 500;

    elements.productList.replaceChildren();

    if (!products.length) {
        const empty = document.createElement("div");

        empty.className = "empty";
        empty.textContent = currentState.scanning
            ? "Получаю товары…"
            : "Подходящих товаров пока нет";

        elements.productList.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const product of products.slice(0, displayLimit))
        fragment.appendChild(createProductElement(product));

    if (products.length > displayLimit) {
        const notice = document.createElement("div");

        notice.className = "empty";
        notice.textContent =
            `Показаны первые ${displayLimit} из ${products.length}. ` +
            `В CSV попадут все товары.`;

        fragment.appendChild(notice);
    }

    elements.productList.appendChild(fragment);
}

async function refreshState() {
    currentState = await sendToContent("OZON_FRESH_GET_STATE");
    render();
}

function escapeCsv(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCsv() {
    const header = [
        "Название",
        "Цена",
        "Старая цена",
        "Скидка",
        "Экономия",
        "Рейтинг",
        "Отзывы",
        "Подходит",
        "Источник",
        "Причины исключения",
        "Ссылка"
    ];

    const rows = getVisibleProducts().map(product => [
        product.title,
        product.price,
        product.oldPrice || "",
        product.discount,
        product.saving || "",
        product.rating || "",
        product.reviewCount || "",
        product.suitable ? "Да" : "Нет",
        sourceTitle(product.source),
        (product.reasons || []).join("; "),
        product.url
    ]);

    const csv = "\uFEFF" +
        [header, ...rows]
            .map(row => row.map(escapeCsv).join(";"))
            .join("\r\n");

    const url = URL.createObjectURL(
        new Blob([csv], {
            type: "text/csv;charset=utf-8"
        })
    );

    const link = document.createElement("a");

    link.href = url;
    link.download = `ozon-products-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    URL.revokeObjectURL(url);
}

elements.startButton.addEventListener("click", async () => {
    try {
        await saveAndApplyRules();

        currentState = {
            ...currentState,
            products: [],
            productCount: 0,
            scanning: true,
            phase: "starting",
            pagesFetched: 0,
            domCount: 0,
            apiCount: 0,
            candidateCount: 0,
            selectedCandidateUrl: "",
            lastError: ""
        };

        render();

        await sendToContent("OZON_FRESH_START");
    } catch (error) {
        currentState.scanning = false;
        currentState.lastError = error.message;
        render();
    }
});

elements.stopButton.addEventListener("click", async () => {
    try {
        await sendToContent("OZON_FRESH_STOP");
        await refreshState();
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.clearButton.addEventListener("click", async () => {
    try {
        await sendToContent("OZON_FRESH_CLEAR");
        await refreshState();
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.exportButton.addEventListener("click", exportCsv);
elements.sortMode.addEventListener("change", render);

for (const element of [
    elements.maxPrice,
    elements.minDiscount,
    elements.greenWords,
    elements.redWords,
    elements.hideUnsuitable,
    elements.includeDomPage,
    elements.pageLimit,
    elements.scrollWaitMs
]) {
    element.addEventListener("input", scheduleApplyRules);
}

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "OZON_FRESH_PROGRESS")
        return;

    if (boundTabId && sender.tab?.id !== boundTabId)
        return;

    currentState = message.payload;
    render();
});

(async () => {
    try {
        await resolveBoundTab();
        await loadSettings();
        await refreshState();
    } catch (error) {
        currentState.lastError = error.message;
        render();
    }
})();