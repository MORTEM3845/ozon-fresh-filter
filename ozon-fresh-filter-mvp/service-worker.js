async function configureTab(tab) {
    if (!tab?.id)
        return;

    const isOzon = tab.url?.startsWith("https://www.ozon.ru/") === true;
    const options = isOzon
        ? { tabId: tab.id, path: `sidepanel.html?tabId=${tab.id}`, enabled: true }
        : { tabId: tab.id, enabled: false };

    try {
        await chrome.sidePanel.setOptions(options);
    } catch (error) {
        console.error("Не удалось настроить боковую панель", error);
    }
}

async function configureExistingTabs() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(configureTab));
}

async function initialize() {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await configureExistingTabs();
}

chrome.runtime.onInstalled.addListener(() => initialize().catch(console.error));
chrome.runtime.onStartup.addListener(() => initialize().catch(console.error));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "complete")
        configureTab(tab).catch(console.error);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        const tab = await chrome.tabs.get(tabId);
        await configureTab(tab);
    } catch (error) {
        console.error(error);
    }
});

initialize().catch(console.error);
