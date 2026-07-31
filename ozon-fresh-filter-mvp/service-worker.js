const PANEL_PATH = "sidepanel.html";

function isOzonUrl(url) {
    return typeof url === "string" && url.startsWith("https://www.ozon.ru/");
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initialize() {
    try {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
        await chrome.sidePanel.setOptions({ enabled: false });
    } catch (error) {
        console.error("Не удалось настроить боковую панель", error);
    }
}

async function waitForTabComplete(tabId, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const tab = await chrome.tabs.get(tabId);

        if (tab.status === "complete")
            return tab;

        await delay(250);
    }

    throw new Error("Страница товара слишком долго загружается");
}

async function sendMessageWithRetry(tabId, message, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (error) {
            lastError = error;
            await delay(300);
        }
    }

    throw lastError || new Error("Код расширения не запустился на странице товара");
}

async function addToCartInBackground(product) {
    if (!product?.url || !product?.id)
        return { ok: false, message: "Некорректные данные товара" };

    const tab = await chrome.tabs.create({ url: product.url, active: false });

    if (!tab.id)
        return { ok: false, message: "Не удалось открыть страницу товара" };

    try {
        await waitForTabComplete(tab.id);
        const result = await sendMessageWithRetry(tab.id, {
            type: "OZON_FRESH_ADD_TO_CART",
            payload: { product, waitMs: 12000 }
        });

        return result?.ok ? result : { ok: false, message: result?.message || "Ozon не добавил товар в корзину" };
    } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
    }
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

chrome.action.onClicked.addListener(tab => {
    if (!tab?.id || !isOzonUrl(tab.url))
        return;

    const tabId = tab.id;

    // Не ждём Promise, иначе Chrome может потерять пользовательский жест.
    chrome.sidePanel.setOptions({
        tabId,
        path: `${PANEL_PATH}?tabId=${tabId}`,
        enabled: true
    }).catch(console.error);

    chrome.sidePanel.open({ tabId }).catch(error => {
        console.error("Не удалось открыть боковую панель", error);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && !isOzonUrl(tab.url))
        chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "OZON_FRESH_ADD_TO_CART_BACKGROUND")
        return;

    addToCartInBackground(message.payload?.product)
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, message: error?.message || String(error) }));

    return true;
});

initialize();
