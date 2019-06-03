import EventBus from '../../event-bus'
import Logs from '../../logs'
import Utils from '../../utils'
import Actions from '.'
import ReqHandler from '../proxy'
import {
  DEFAULT_PANELS,
  DEFAULT_BOOKMARKS_PANEL,
  DEFAULT_PRIVATE_TABS_PANEL,
  DEFAULT_TABS_PANEL,
  DEFAULT_CTX_TABS_PANEL,
} from '../config/panels'

let recalcPanelScrollTimeout, updateReqHandlerTimeout, savePanelsTimeout

/**
 * Load Contextual Identities and containers
 * and merge them
 */
async function loadPanels() {
  // Get contextual identities
  const containers = await browser.contextualIdentities.query({})
  if (!containers) {
    Logs.push('[WARN] Cannot load contextual identities')
    this.state.panels = Utils.cloneArray(DEFAULT_PANELS)
    return
  }

  // Get saved panels
  // Changed storage: containers -> panels
  let ans = await browser.storage.local.get('panels')
  // ---------------------------- UNTIL 3.1.0 --------------------------------
  if (!ans || !ans.panels) {
    ans = await browser.storage.local.get('containers')
    ans.panels = ans.containers
  }
  // ---------------------------- UNTIL 3.1.0 --------------------------------
  if (!ans || !ans.panels) Logs.push('[WARN] Cannot load panels')

  const panels = []
  const panelsMap = {}
  for (let i = 0; i < ans.panels.length; i++) {
    const loadedPanel = ans.panels[i]

    // Bookmarks panel
    if (loadedPanel.type === 'bookmarks') {
      let panel = Utils.cloneObject(DEFAULT_BOOKMARKS_PANEL)
      panel.index = i
      panel.lockedPanel = loadedPanel.lockedPanel
      panels.push(panel)
      panelsMap['bookmarks'] = panel
    }

    // Private panel
    if (loadedPanel.type === 'private') {
      panels.push(Utils.cloneObject(DEFAULT_PRIVATE_TABS_PANEL))
    }

    // Default panel
    if (loadedPanel.type === 'default') {
      let panel = Utils.cloneObject(DEFAULT_TABS_PANEL)
      panel.index = i
      panel.lastActiveTab = loadedPanel.lastActiveTab
      panel.lockedPanel = loadedPanel.lockedPanel
      panel.lockedTabs = loadedPanel.lockedTabs
      panel.noEmpty = loadedPanel.noEmpty
      panels.push(panel)
      panelsMap[panel.cookieStoreId] = panel
    }

    // Container panel
    if (loadedPanel.type === 'ctx') {
      const container = containers.find(c => c.cookieStoreId === loadedPanel.cookieStoreId)
      const panel = Utils.cloneObject(DEFAULT_CTX_TABS_PANEL)

      // Native container props
      if (container) {
        panel.cookieStoreId = container.cookieStoreId
        panel.name = container.name
        panel.colorCode = container.colorCode
        panel.color = container.color
        panel.icon = container.icon
        panel.iconUrl = container.iconUrl
      } else {
        const conf = {
          name: loadedPanel.name,
          color: loadedPanel.color,
          icon: loadedPanel.icon,
        }
        const newCtr = await browser.contextualIdentities.create(conf)
        panel.cookieStoreId = newCtr.cookieStoreId
        panel.name = newCtr.name
        panel.colorCode = newCtr.colorCode
        panel.color = newCtr.color
        panel.icon = newCtr.icon
        panel.iconUrl = newCtr.iconUrl
      }

      // Sidebery props
      panel.index = i
      panel.lockedTabs = loadedPanel.lockedTabs
      panel.lockedPanel = loadedPanel.lockedPanel
      panel.proxy = loadedPanel.proxy
      panel.proxified = loadedPanel.proxified
      panel.noEmpty = loadedPanel.noEmpty
      panel.includeHostsActive = loadedPanel.includeHostsActive
      panel.includeHosts = loadedPanel.includeHosts
      panel.excludeHostsActive = loadedPanel.excludeHostsActive
      panel.excludeHosts = loadedPanel.excludeHosts
      panel.lastActiveTab = loadedPanel.lastActiveTab

      panels.push(panel)
      panelsMap[panel.cookieStoreId] = panel
    }
  }

  // Append not-saved native containers
  for (let container of containers) {
    if (!panelsMap[container.cookieStoreId]) {
      let panel = Utils.cloneObject(DEFAULT_CTX_TABS_PANEL)
      panel.cookieStoreId = container.cookieStoreId
      panel.name = container.name
      panel.colorCode = container.colorCode
      panel.color = container.color
      panel.icon = container.icon
      panel.iconUrl = container.iconUrl
      const len = panels.push(panel)
      panel.index = len - 1
      panelsMap[panel.cookieStoreId] = panel
    }
  }

  this.state.containers = containers
  this.state.panels = panels
  this.state.panelsMap = panelsMap

  if (this.state.panelIndex >= this.state.panels.length) {
    this.state.panelIndex = this.state.private ? 1 : 2
  }

  // Set requests handler (if needed)
  Actions.updateReqHandler()

  Logs.push('[INFO] Containers loaded')
}

/**
 * Update panels settings
 */
async function updatePanels(newPanels) {
  if (!newPanels) return

  for (let panel of this.state.panels) {
    const newPanel = newPanels.find(nc => nc.id === panel.id)
    if (!newPanel) continue

    panel.lockedTabs = newPanel.lockedTabs
    panel.lockedPanel = newPanel.lockedPanel
    panel.proxy = newPanel.proxy
    panel.proxified = newPanel.proxified
    panel.noEmpty = newPanel.noEmpty
    panel.includeHostsActive = newPanel.includeHostsActive
    panel.includeHosts = newPanel.includeHosts
    panel.excludeHostsActive = newPanel.excludeHostsActive
    panel.excludeHosts = newPanel.excludeHosts
    panel.lastActiveTab = newPanel.lastActiveTab
  }

  Actions.updateReqHandlerDebounced()
}

/**
 * Update tabs per panel with range indexes
 */
function updatePanelsTabs() {
  let lastIndex = this.getters.pinnedTabs.length
  for (let panel of this.state.panels) {
    if (panel.panel !== 'TabsPanel') continue

    panel.tabs = []
    for (let t of this.state.tabs) {
      if (t.pinned) continue
      if (t.cookieStoreId === panel.cookieStoreId) panel.tabs.push(t)
    }
    if (panel.tabs.length) {
      lastIndex = panel.tabs[panel.tabs.length - 1].index
      panel.startIndex = panel.tabs[0].index
      panel.endIndex = lastIndex++
    } else {
      panel.startIndex = lastIndex
      panel.endIndex = panel.startIndex
    }
  }
}

/**
 * Update panels ranges
 */
function updatePanelsRanges() {
  let lastIndex = this.getters.pinnedTabs.length
  let countOfPanels = this.state.panels.length
  for (let i = 0; i < countOfPanels; i++) {
    let panel = this.state.panels[i]
    panel.index = i
    if (panel.panel !== 'TabsPanel') continue
    if (panel.tabs.length) {
      lastIndex = panel.tabs[panel.tabs.length - 1].index
      panel.startIndex = panel.tabs[0].index
      panel.endIndex = lastIndex++
    } else {
      panel.startIndex = lastIndex
      panel.endIndex = panel.startIndex
    }
  }
}

/**
 * Save panels
 */
async function savePanels() {
  if (!this.state.windowFocused) return
  const output = []
  for (let panel of this.state.panels) {
    output.push({
      cookieStoreId: panel.cookieStoreId,
      colorCode: panel.colorCode,
      color: panel.color,
      icon: panel.icon,
      iconUrl: panel.iconUrl,
      name: panel.name,

      type: panel.type,
      id: panel.id,
      dashboard: panel.dashboard,
      panel: panel.panel,
      lockedTabs: panel.lockedTabs,
      lockedPanel: panel.lockedPanel,
      proxy: panel.proxy,
      proxified: panel.proxified,
      noEmpty: panel.noEmpty,
      includeHostsActive: panel.includeHostsActive,
      includeHosts: panel.includeHosts,
      excludeHostsActive: panel.excludeHostsActive,
      excludeHosts: panel.excludeHosts,
      lastActiveTab: panel.lastActiveTab,
      private: panel.private,
      bookmarks: panel.bookmarks,
    })
  }
  const cleaned = JSON.parse(JSON.stringify(output))
  await browser.storage.local.set({ panels: cleaned })
}
function savePanelsDebounced() {
  if (savePanelsTimeout) clearTimeout(savePanelsTimeout)
  savePanelsTimeout = setTimeout(() => Actions.savePanels(), 500)
}

/**
 * Try to load saved sidebar state
 */
async function loadPanelIndex() {
  let ans = await browser.storage.local.get('panelIndex')
  if (!ans) return

  if (!this.state.private && ans.panelIndex !== 1) {
    if (ans.panelIndex >= 0) {
      this.state.panelIndex = ans.panelIndex
    }
  }
}

/**
 * Set panel index
 */
function setPanel(newIndex) {
  if (this.state.panelIndex === newIndex) return
  this.state.panelIndex = newIndex
  if (newIndex >= 0) this.state.lastPanelIndex = newIndex
}

/**
 * Save panel index
 */
function savePanelIndex() {
  if (!this.state.windowFocused || this.state.private) return
  browser.storage.local.set({ panelIndex: this.state.panelIndex })
}

/**
 * Breadcast recalc panel's scroll event.
 */
function recalcPanelScroll() {
  if (recalcPanelScrollTimeout) clearTimeout(recalcPanelScrollTimeout)
  recalcPanelScrollTimeout = setTimeout(() => {
    EventBus.$emit('recalcPanelScroll')
    recalcPanelScrollTimeout = null
  }, 200)
}

/**
 * Switch current active panel by index
 */
function switchToPanel(index) {
  Actions.closeCtxMenu()
  Actions.resetSelection()
  Actions.setPanel(index)

  if (this.state.dashboardOpened) EventBus.$emit('openDashboard', this.state.panelIndex)
  const panel = this.state.panels[this.state.panelIndex]
  if (panel.noEmpty && panel.tabs && !panel.tabs.length) {
    Actions.createTab(panel.cookieStoreId)
  }

  if (this.state.activateLastTabOnPanelSwitching) {
    Actions.activateLastActiveTabOf(this.state.panelIndex)
  }

  Actions.recalcPanelScroll()
  Actions.updateTabsVisability()
  EventBus.$emit('panelSwitched')
  Actions.savePanelIndex()
}

/**
 * Switch panel.
 */
async function switchPanel(dir = 0) {
  // Debounce switching
  if (this.state.switchPanelPause) return
  this.state.switchPanelPause = setTimeout(() => {
    clearTimeout(this.state.switchPanelPause)
    this.state.switchPanelPause = null
  }, 128)

  Actions.closeCtxMenu()
  Actions.resetSelection()

  // Restore prev front panel
  if (this.state.panelIndex < 0) {
    if (this.state.lastPanelIndex < 0) this.state.panelIndex = 0
    else this.state.panelIndex = this.state.lastPanelIndex - dir
  }

  // Update panel index
  let i = this.state.panelIndex + dir
  for (; this.state.panels[i]; i += dir) {
    const p = this.state.panels[i]
    if (this.state.skipEmptyPanels && p.tabs && !p.tabs.length) continue
    if (!p.inactive) break
  }
  if (this.state.panels[i]) {
    this.state.panelIndex = i
    Actions.savePanelIndex()
  }
  this.state.lastPanelIndex = this.state.panelIndex

  if (this.state.activateLastTabOnPanelSwitching) {
    Actions.activateLastActiveTabOf(this.state.panelIndex)
  }

  if (this.state.dashboardOpened) EventBus.$emit('openDashboard', this.state.panelIndex)
  let panel = this.state.panels[this.state.panelIndex]
  if (panel.noEmpty && panel.tabs && !panel.tabs.length) {
    Actions.createTab(panel.cookieStoreId)
  }

  Actions.recalcPanelScroll()
  Actions.updateTabsVisability()
  EventBus.$emit('panelSwitched')
}

/**
 * Find panel with active tab and switch to it.
 */
function goToActiveTabPanel() {
  const activeTab = this.state.tabs.find(t => t.active)
  const panel = this.state.panelsMap[activeTab.cookieStoreId]
  if (panel) Actions.switchToPanel(panel.index)
}

/**
 * Update request handler
 */
async function updateReqHandler() {
  this.state.proxies = {}
  this.state.includeHostsRules = []
  this.state.excludeHostsRules = {}

  for (let ctr of this.state.panels) {
    // Proxy
    if (ctr.proxified && ctr.proxy) this.state.proxies[ctr.id] = { ...ctr.proxy }

    // Include rules
    if (ctr.includeHostsActive) {
      for (let rawRule of ctr.includeHosts.split('\n')) {
        let rule = rawRule.trim()
        if (!rule) continue

        if (rule[0] === '/' && rule[rule.length - 1] === '/') {
          rule = new RegExp(rule.slice(1, rule.length - 1))
        }

        this.state.includeHostsRules.push({ ctx: ctr.id, value: rule })
      }
    }

    // Exclude rules
    if (ctr.excludeHostsActive) {
      this.state.excludeHostsRules[ctr.id] = ctr.excludeHosts
        .split('\n')
        .map(r => {
          let rule = r.trim()

          if (rule[0] === '/' && rule[rule.length - 1] === '/') {
            rule = new RegExp(rule.slice(1, rule.length - 1))
          }

          return rule
        })
        .filter(r => r)
    }
  }

  // Turn on request handler
  const incRulesOk = this.state.includeHostsRules.length > 0
  const excRulesOk = Object.keys(this.state.excludeHostsRules).length > 0
  const proxyOk = Object.keys(this.state.proxies).length > 0
  if (incRulesOk || excRulesOk || proxyOk) Actions.turnOnReqHandler()
  else Actions.turnOffReqHandler()
}

/**
 * Update request handler debounced
 */
function updateReqHandlerDebounced() {
  if (updateReqHandlerTimeout) clearTimeout(updateReqHandlerTimeout)
  updateReqHandlerTimeout = setTimeout(() => {
    Actions.updateReqHandler()
    updateReqHandlerTimeout = null
  }, 500)
}

/**
 * Set request handler
 */
function turnOnReqHandler() {
  if (this.state.private) return
  if (!browser.proxy.onRequest.hasListener(ReqHandler)) {
    browser.proxy.onRequest.addListener(ReqHandler, { urls: ['<all_urls>'] })
  }
}

/**
 * Unset request handler
 */
function turnOffReqHandler() {
  if (this.state.private) return
  if (browser.proxy.onRequest.hasListener(ReqHandler)) {
    browser.proxy.onRequest.removeListener(ReqHandler)
  }
}

export default {
  loadPanels,
  updatePanels,
  updatePanelsTabs,
  updatePanelsRanges,
  savePanels,
  savePanelsDebounced,
  loadPanelIndex,
  setPanel,
  savePanelIndex,
  recalcPanelScroll,
  switchToPanel,
  switchPanel,
  goToActiveTabPanel,
  updateReqHandler,
  updateReqHandlerDebounced,
  turnOnReqHandler,
  turnOffReqHandler,
}
