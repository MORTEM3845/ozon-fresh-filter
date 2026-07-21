const PANEL_PATH = "sidepanel.html";

function isOzonUrl(url) {
    return typeof url === "string" && url.startsWith("https://www.ozon.ru/");
}

async function initialize() {
    try {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
        await chrome.sidePanel.setOptions({ enabled: false });
    } catch (error) {
        console.error("Не удалось настроить боковую панель", error);
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

initialize();