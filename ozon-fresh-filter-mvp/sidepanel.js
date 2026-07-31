const panelParams = new URLSearchParams(location.search);
let boundTabId = Number(panelParams.get("tabId")) || null;

const elements = {
    status: document.getElementById("status"),
    startButton: document.getElementById("startButton"),
    stopButton: document.getElementById("stopButton"),
    clearButton: document.getElementById("clearButton"),
    maxPrice: document.getElementById("maxPrice"),
    minDiscount: document.getElementById("minDiscount"),
    minRating: document.getElementById("minRating"),
    minReviews: document.getElementById("minReviews"),
    greenWords: document.getElementById("greenWords"),
    redWords: document.getElementById("redWords"),
    categoryChips: document.getElementById("categoryChips"),
    hideUnsuitable: document.getElementById("hideUnsuitable"),
    includeDomPage: document.getElementById("includeDomPage"),
    pageLimit: document.getElementById("pageLimit"),
    scrollWaitMs: document.getElementById("scrollWaitMs"),
    totalCount: document.getElementById("totalCount"),
    suitableCount: document.getElementById("suitableCount"),
    hiddenCount: document.getElementById("hiddenCount"),
    pagesCount: document.getElementById("pagesCount"),
    sortMode: document.getElementById("sortMode"),
    nutritionButton: document.getElementById("nutritionButton"),
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
    nutritionLoading: false,
    nutritionTotal: 0,
    nutritionProcessed: 0,
    nutritionFound: 0,
    nutritionMissing: 0,
    nutritionErrors: 0,
    interceptorReady: false,
    selectedCandidateUrl: "",
    lastError: ""
};

let excludedCategories = new Set();
let applyTimer = null;
const cartStates = new Map();

function parseWords(value) {
    return String(value || "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
}

function getRules() {
    return {
        maxPrice: Number(elements.maxPrice.value) || 0,
        minDiscount: Number(elements.minDiscount.value) || 0,
        minRating: Number(elements.minRating.value) || 0,
        minReviews: Number(elements.minReviews.value) || 0,
        greenWords: parseWords(elements.greenWords.value),
        redWords: parseWords(elements.redWords.value),
        excludedCategories: [...excludedCategories],
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

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0] || null;
    boundTabId = tab?.id || null;
    return tab;
}

async function sendToContent(type, payload = null) {
    const tab = await resolveBoundTab();

    if (!tab?.id || !tab.url?.startsWith("https://www.ozon.ru/"))
        throw new Error("Панель не привязана к вкладке Ozon");

    try {
        return await chrome.tabs.sendMessage(tab.id, { type, payload });
    } catch {
        throw new Error("Не найден код расширения на странице. Обнови вкладку Ozon через Ctrl + Shift + R");
    }
}

async function loadSettings() {
    const result = await chrome.storage.local.get("ozonFreshFilterRules");
    const rules = result.ozonFreshFilterRules || {};

    elements.maxPrice.value = rules.maxPrice || "";
    elements.minDiscount.value = rules.minDiscount || 0;
    elements.minRating.value = rules.minRating || "";
    elements.minReviews.value = rules.minReviews || "";
    elements.greenWords.value = (rules.greenWords || []).join(", ");
    elements.redWords.value = (rules.redWords || []).join(", ");
    excludedCategories = new Set(rules.excludedCategories || []);
    elements.hideUnsuitable.checked = rules.hideUnsuitable !== false;
    elements.includeDomPage.checked = rules.includeDomPage !== false;
    elements.pageLimit.value = rules.pageLimit || 100;
    elements.scrollWaitMs.value = rules.scrollWaitMs || 2500;
}

async function saveAndApplyRules() {
    const rules = getRules();
    await chrome.storage.local.set({ ozonFreshFilterRules: rules });
    currentState = await sendToContent("OZON_FRESH_APPLY_RULES", rules);
    render();
}

function scheduleApplyRules() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => saveAndApplyRules().catch(error => setStatus(error.message, true)), 250);
}

function setStatus(text, error = false, success = false) {
    elements.status.textContent = text;
    elements.status.classList.toggle("error", error);
    elements.status.classList.toggle("success", success);
}

function getAllProducts() {
    return [...(currentState.products || [])];
}

function renderCategoryFilter(products) {
    const counts = new Map();

    for (const product of products) {
        const category = product.category || "Другое";
        counts.set(category, (counts.get(category) || 0) + 1);
    }

    const categories = [...new Set([...counts.keys(), ...excludedCategories])]
        .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b, "ru"));

    elements.categoryChips.replaceChildren();

    if (!categories.length) {
        const placeholder = document.createElement("span");
        placeholder.className = "category-placeholder";
        placeholder.textContent = "Появятся после сбора товаров";
        elements.categoryChips.appendChild(placeholder);
        return;
    }

    for (const category of categories) {
        const button = document.createElement("button");
        const excluded = excludedCategories.has(category);
        const count = counts.get(category) || 0;

        button.type = "button";
        button.className = `category-chip${excluded ? " excluded" : ""}`;
        button.textContent = `${category} ${count}`;
        button.title = excluded ? "Категория исключена. Нажми, чтобы вернуть" : "Нажми, чтобы исключить";

        button.addEventListener("click", () => {
            if (excludedCategories.has(category))
                excludedCategories.delete(category);
            else
                excludedCategories.add(category);

            saveAndApplyRules().catch(error => setStatus(error.message, true));
        });

        elements.categoryChips.appendChild(button);
    }
}

function getVisibleProducts() {
    const allProducts = getAllProducts();
    const products = elements.hideUnsuitable.checked ? allProducts.filter(x => x.suitable) : allProducts;
    const mode = elements.sortMode.value;

    if (mode === "discount") {
        products.sort((a, b) => b.discount - a.discount || a.price - b.price);
    } else if (mode === "rating") {
        products.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0) || a.price - b.price);
    } else if (mode === "reviews") {
        products.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0) || (b.rating || 0) - (a.rating || 0) || a.price - b.price);
    } else if (mode === "eatSoon") {
        products.sort((a, b) => Number(Boolean(b.eatSoon)) - Number(Boolean(a.eatSoon)) || b.discount - a.discount || a.price - b.price);
    } else if (mode === "priceAsc") {
        products.sort((a, b) => a.price - b.price || b.discount - a.discount);
    } else if (mode === "priceDesc") {
        products.sort((a, b) => b.price - a.price || b.discount - a.discount);
    } else if (mode === "saving") {
        products.sort((a, b) => b.saving - a.saving || b.discount - a.discount || a.price - b.price);
    } else {
        products.sort((a, b) => Number(b.suitable) - Number(a.suitable) || b.score - a.score || a.price - b.price);
    }

    return products;
}

function sourceTitle(source) {
    return source === "api" ? "API" : "страница";
}

function formatNumber(value) {
    return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

function formatNutritionValue(value) {
    if (value == null)
        return "—";

    return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function createNutritionElement(product) {
    if (!product.nutrition && product.nutritionStatus !== "loading")
        return null;

    const root = document.createElement("div");
    root.className = "nutrition";

    if (product.nutritionStatus === "loading") {
        root.classList.add("loading");
        root.textContent = "БЖУ загружается…";
        return root;
    }

    const nutrition = product.nutrition;
    const values = [
        ["Б", nutrition.proteins, "Белки"],
        ["Ж", nutrition.fats, "Жиры"],
        ["У", nutrition.carbs, "Углеводы"]
    ];

    for (const [shortName, value, fullName] of values) {
        if (value == null)
            continue;

        const item = document.createElement("span");
        item.className = "nutrition-item";
        item.textContent = `${shortName} ${formatNutritionValue(value)}`;
        item.title = `${fullName}: ${formatNutritionValue(value)} г`;
        root.appendChild(item);
    }

    if (nutrition.calories != null) {
        const calories = document.createElement("span");
        calories.className = "nutrition-item calories";
        calories.textContent = `${formatNutritionValue(nutrition.calories)} ккал`;
        calories.title = `Калорийность: ${formatNutritionValue(nutrition.calories)} ккал`;
        root.appendChild(calories);
    }

    if (nutrition.basis)
        root.title = `Значения на ${nutrition.basis}`;

    return root.childElementCount ? root : null;
}

async function addProductToCart(product) {
    cartStates.set(product.id, "loading");
    render();

    try {
        let result = await sendToContent("OZON_FRESH_ADD_TO_CART", { product, waitMs: 700 });

        if (!result?.ok) {
            result = await chrome.runtime.sendMessage({
                type: "OZON_FRESH_ADD_TO_CART_BACKGROUND",
                payload: { product }
            });
        }

        if (!result?.ok)
            throw new Error(result?.message || "Ozon не добавил товар в корзину");

        cartStates.set(product.id, "success");
        render();
        setStatus(`«${product.title}» добавлен в корзину`, false, true);

        setTimeout(() => {
            if (cartStates.get(product.id) === "success") {
                cartStates.delete(product.id);
                render();
            }
        }, 2500);
    } catch (error) {
        cartStates.set(product.id, "error");
        render();
        setStatus(error.message, true);

        setTimeout(() => {
            if (cartStates.get(product.id) === "error") {
                cartStates.delete(product.id);
                render();
            }
        }, 3500);
    }
}

function createProductElement(product) {
    const root = document.createElement("article");
    root.className = `product${product.suitable ? "" : " unsuitable"}`;
    root.title = "Открыть товар";
    root.addEventListener("click", () => chrome.tabs.create({ url: product.url, active: true }));

    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";

    if (product.image)
        image.src = product.image;

    const body = document.createElement("div");
    body.className = "product-body";

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
    discount.textContent = product.discount ? `−${product.discount}%` : "без скидки";
    meta.appendChild(discount);

    if (product.rating || product.reviewCount) {
        const rating = document.createElement("span");
        const ratingText = product.rating ? Number(product.rating).toFixed(1) : "—";
        rating.className = "rating";
        rating.textContent = product.reviewCount ? `${ratingText} · ${formatNumber(product.reviewCount)}` : ratingText;
        rating.title = product.reviewCount ? `Рейтинг ${ratingText}, отзывов: ${formatNumber(product.reviewCount)}` : `Рейтинг ${ratingText}`;
        meta.appendChild(rating);
    }

    if (product.eatSoon) {
        const eatSoon = document.createElement("span");
        eatSoon.className = "eat-soon";
        eatSoon.textContent = "⏳";
        eatSoon.title = "Съешьте скорее";
        meta.appendChild(eatSoon);
    }

    if (product.category) {
        const category = document.createElement("span");
        category.className = "product-category";
        category.textContent = product.category;
        category.title = product.ozonCategory ? `Категория Ozon: ${product.ozonCategory}` : "Категория определена по названию";
        meta.appendChild(category);
    }

    const source = document.createElement("span");
    source.className = "source";
    source.textContent = sourceTitle(product.source);
    meta.appendChild(source);

    body.append(title, meta);

    const nutrition = createNutritionElement(product);

    if (nutrition)
        body.appendChild(nutrition);

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

    const actions = document.createElement("div");
    actions.className = "product-actions";

    const cartButton = document.createElement("button");
    const cartState = cartStates.get(product.id);
    cartButton.type = "button";
    cartButton.className = `cart-button${cartState ? ` ${cartState}` : ""}`;
    cartButton.disabled = cartState === "loading";
    cartButton.textContent = cartState === "loading" ? "Добавляю…" : cartState === "success" ? "✓ В корзине" : cartState === "error" ? "Ошибка" : "В корзину";
    cartButton.title = "Добавить одну штуку в корзину Ozon";
    cartButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        addProductToCart(product);
    });

    actions.appendChild(cartButton);
    body.appendChild(actions);
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

    if (currentState.nutritionLoading) {
        setStatus(`Загружаю БЖУ: ${currentState.nutritionProcessed || 0}/${currentState.nutritionTotal || 0}`);
        return;
    }

    if (currentState.nutritionTotal > 0 && currentState.nutritionProcessed >= currentState.nutritionTotal) {
        setStatus(`БЖУ: найдено ${currentState.nutritionFound || 0}, без данных ${currentState.nutritionMissing || 0}, ошибок ${currentState.nutritionErrors || 0}`, false, true);
        return;
    }

    const phase = currentState.phase;

    if (phase === "starting")
        setStatus("Подготавливаю сбор товаров…");
    else if (phase === "dom")
        setStatus(`Получаю первую видимую страницу. Найдено: ${total}`);
    else if (phase === "capturing")
        setStatus(`Ищу внутренний запрос Ozon. Найдено: ${total}`);
    else if (phase === "technical-scroll")
        setStatus(`Провоцирую загрузку следующей пачки. Найдено: ${total}`);
    else if (phase === "fetching-captured-url")
        setStatus("Повторно запрашиваю пойманный URL…");
    else if (phase === "candidate-selected")
        setStatus(`API-запрос найден. Товаров: ${total}`);
    else if (phase === "chain")
        setStatus(`Получаю API-страницу ${currentState.pagesFetched + 1}. Уже найдено: ${total}`);
    else if (phase === "finished")
        setStatus(`Готово. API-страниц: ${currentState.pagesFetched}, товаров: ${total}`, false, true);
    else if (phase === "stopped")
        setStatus(`Сбор остановлен. Найдено товаров: ${total}`);
    else
        setStatus("Нажми «Собрать товары»");
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
    elements.nutritionButton.disabled = currentState.scanning || currentState.nutritionLoading || total === 0;
    elements.nutritionButton.textContent = currentState.nutritionLoading
        ? `БЖУ ${currentState.nutritionProcessed || 0}/${currentState.nutritionTotal || 0}`
        : "БЖУ";
    elements.interceptorState.textContent = currentState.interceptorReady ? "готов" : "не найден";
    elements.candidateCount.textContent = currentState.candidateCount || 0;
    elements.domCount.textContent = currentState.domCount || 0;
    elements.apiCount.textContent = currentState.apiCount || 0;
    elements.selectedUrl.textContent = currentState.selectedCandidateUrl || "";

    renderCategoryFilter(allProducts);
    renderStatus(total);

    const products = getVisibleProducts();
    const displayLimit = 500;
    elements.productList.replaceChildren();

    if (!products.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = currentState.scanning ? "Получаю товары…" : "Подходящих товаров пока нет";
        elements.productList.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const product of products.slice(0, displayLimit))
        fragment.appendChild(createProductElement(product));

    if (products.length > displayLimit) {
        const notice = document.createElement("div");
        notice.className = "empty";
        notice.textContent = `Показаны первые ${displayLimit} из ${products.length}. В CSV попадут все товары.`;
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
        "Название", "Категория", "Категория Ozon", "Съешьте скорее", "Цена", "Старая цена", "Скидка",
        "Экономия", "Рейтинг", "Отзывы", "Белки", "Жиры", "Углеводы", "Ккал", "Основа БЖУ",
        "Подходит", "Источник", "Причины исключения", "Ссылка"
    ];

    const rows = getVisibleProducts().map(product => [
        product.title,
        product.category || "",
        product.ozonCategory || "",
        product.eatSoon ? "Да" : "Нет",
        product.price,
        product.oldPrice || "",
        product.discount,
        product.saving || "",
        product.rating || "",
        product.reviewCount || "",
        product.nutrition?.proteins ?? "",
        product.nutrition?.fats ?? "",
        product.nutrition?.carbs ?? "",
        product.nutrition?.calories ?? "",
        product.nutrition?.basis || "",
        product.suitable ? "Да" : "Нет",
        sourceTitle(product.source),
        (product.reasons || []).join("; "),
        product.url
    ]);

    const csv = "\uFEFF" + [header, ...rows].map(row => row.map(escapeCsv).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ozon-products-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

elements.startButton.addEventListener("click", async () => {
    try {
        await saveAndApplyRules();
        cartStates.clear();
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
            nutritionLoading: false,
            nutritionTotal: 0,
            nutritionProcessed: 0,
            nutritionFound: 0,
            nutritionMissing: 0,
            nutritionErrors: 0,
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
        cartStates.clear();
        await sendToContent("OZON_FRESH_CLEAR");
        await refreshState();
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.nutritionButton.addEventListener("click", async () => {
    const productIds = getVisibleProducts()
        .filter(product => !product.nutrition && product.nutritionStatus !== "loading" && product.nutritionStatus !== "missing")
        .map(product => product.id);

    if (!productIds.length) {
        setStatus("Для показанных товаров БЖУ уже загружено или отсутствует", false, true);
        return;
    }

    try {
        await sendToContent("OZON_FRESH_LOAD_NUTRITION", { productIds });
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.exportButton.addEventListener("click", exportCsv);
elements.sortMode.addEventListener("change", render);

for (const element of [
    elements.maxPrice,
    elements.minDiscount,
    elements.minRating,
    elements.minReviews,
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
        currentState = await sendToContent("OZON_FRESH_APPLY_RULES", getRules());
        render();
    } catch (error) {
        currentState.lastError = error.message;
        render();
    }
})();
