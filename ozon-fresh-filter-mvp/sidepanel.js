const panelParams = new URLSearchParams(location.search);
const boundTabId = Number(panelParams.get("tabId")) || null;

const elements = {
    status: document.getElementById("status"), startButton: document.getElementById("startButton"),
    stopButton: document.getElementById("stopButton"), clearButton: document.getElementById("clearButton"),
    maxPrice: document.getElementById("maxPrice"), minDiscount: document.getElementById("minDiscount"),
    greenWords: document.getElementById("greenWords"), redWords: document.getElementById("redWords"),
    hideUnsuitable: document.getElementById("hideUnsuitable"), totalCount: document.getElementById("totalCount"),
    suitableCount: document.getElementById("suitableCount"), hiddenCount: document.getElementById("hiddenCount"),
    sortMode: document.getElementById("sortMode"), exportButton: document.getElementById("exportButton"),
    productList: document.getElementById("productList")
};

let currentState = { products: [], scanning: false, step: 0, stableRounds: 0 };
let applyTimer = null;

function parseWords(value) {
    return value.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
}

function getRules() {
    return {
        maxPrice: Number(elements.maxPrice.value) || 0,
        minDiscount: Number(elements.minDiscount.value) || 0,
        greenWords: parseWords(elements.greenWords.value),
        redWords: parseWords(elements.redWords.value),
        hideUnsuitable: elements.hideUnsuitable.checked
    };
}

async function getBoundOzonTab() {
    if (!boundTabId)
        return null;

    try {
        const tab = await chrome.tabs.get(boundTabId);
        if (!tab?.url?.startsWith("https://www.ozon.ru/"))
            return null;

        return tab;
    } catch {
        return null;
    }
}

async function sendToContent(type, payload = null) {
    const tab = await getBoundOzonTab();
    if (!tab)
        throw new Error("Эта панель привязана к закрытой или не-Ozon вкладке");
    return chrome.tabs.sendMessage(tab.id, { type, payload });
}

async function loadSettings() {
    const { ozonFreshFilterRules = {} } = await chrome.storage.local.get("ozonFreshFilterRules");
    elements.maxPrice.value = ozonFreshFilterRules.maxPrice || "";
    elements.minDiscount.value = ozonFreshFilterRules.minDiscount || 0;
    elements.greenWords.value = (ozonFreshFilterRules.greenWords || []).join(", ");
    elements.redWords.value = (ozonFreshFilterRules.redWords || []).join(", ");
    elements.hideUnsuitable.checked = ozonFreshFilterRules.hideUnsuitable !== false;
}

async function saveAndApplyRules() {
    const rules = getRules();
    await chrome.storage.local.set({ ozonFreshFilterRules: rules });
    currentState = await sendToContent("OZON_APPLY_RULES", rules);
    render();
}

function scheduleApplyRules() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => saveAndApplyRules().catch(error => setStatus(error.message, true)), 300);
}

function setStatus(text, error = false) {
    elements.status.textContent = text;
    elements.status.style.color = error ? "#c73d3d" : "";
}

function sortedProducts() {
    const products = [...(currentState.products || [])];
    const mode = elements.sortMode.value;

    if (mode === "discount")
        products.sort((a, b) => b.discount - a.discount || a.price - b.price);
    else if (mode === "priceAsc")
        products.sort((a, b) => a.price - b.price);
    else if (mode === "priceDesc")
        products.sort((a, b) => b.price - a.price);
    else
        products.sort((a, b) => Number(b.suitable) - Number(a.suitable) || b.score - a.score || a.price - b.price);

    return products;
}

function createProductElement(product) {
    const root = document.createElement("article");
    root.className = `product${product.suitable ? "" : " unsuitable"}`;
    root.title = "Открыть товар";
    root.addEventListener("click", () => chrome.tabs.create({ url: product.url }));

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

    const discount = document.createElement("span");
    discount.className = "discount";
    discount.textContent = `−${product.discount}%`;

    const score = document.createElement("span");
    score.textContent = `оценка ${product.score}`;

    meta.append(price, discount, score);
    body.append(title, meta);

    if (!product.suitable) {
        const reason = document.createElement("div");
        reason.className = "reason";
        reason.textContent = (product.reasons || []).join("; ");
        body.appendChild(reason);
    }

    root.append(image, body);
    return root;
}

function render() {
    const products = sortedProducts();
    const suitable = products.filter(x => x.suitable).length;

    elements.totalCount.textContent = products.length;
    elements.suitableCount.textContent = suitable;
    elements.hiddenCount.textContent = products.length - suitable;
    elements.startButton.disabled = currentState.scanning;
    elements.stopButton.disabled = !currentState.scanning;

    if (currentState.scanning)
        setStatus(`Сканирование: шаг ${currentState.step}, найдено ${products.length}`);
    else if (products.length)
        setStatus(`Готово. Собрано товаров: ${products.length}`);
    else
        setStatus("Открой каталог Ozon и нажми «Собрать все товары»");

    elements.productList.replaceChildren();
    if (!products.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "Пока ничего не собрано";
        elements.productList.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const product of products)
        fragment.appendChild(createProductElement(product));
    elements.productList.appendChild(fragment);
}

async function refreshState() {
    try {
        currentState = await sendToContent("OZON_GET_STATE");
        render();
    } catch (error) {
        currentState = { products: [], scanning: false, step: 0, stableRounds: 0 };
        render();
        setStatus(`${error.message}. После установки обнови страницу Ozon.`, true);
    }
}

function escapeCsv(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCsv() {
    const header = ["Название", "Цена", "Старая цена", "Скидка", "Подходит", "Оценка", "Причины", "Ссылка"];
    const rows = sortedProducts().map(product => [
        product.title, product.price, product.oldPrice || "", product.discount,
        product.suitable ? "Да" : "Нет", product.score, (product.reasons || []).join("; "), product.url
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
        await sendToContent("OZON_START_SCAN");
        await refreshState();
    } catch (error) {
        setStatus(error.message, true);
    }
});

elements.stopButton.addEventListener("click", () => sendToContent("OZON_STOP_SCAN").catch(error => setStatus(error.message, true)));
elements.clearButton.addEventListener("click", async () => {
    try {
        await sendToContent("OZON_CLEAR_DATA");
        await refreshState();
    } catch (error) {
        setStatus(error.message, true);
    }
});
elements.exportButton.addEventListener("click", exportCsv);
elements.sortMode.addEventListener("change", render);

for (const element of [elements.maxPrice, elements.minDiscount, elements.greenWords, elements.redWords, elements.hideUnsuitable])
    element.addEventListener("input", scheduleApplyRules);

chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "OZON_SCAN_PROGRESS")
        return;
    currentState = message.payload;
    render();
});

(async () => {
    await loadSettings();
    await refreshState();
    setInterval(refreshState, 1600);
})();
