<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    LockKeyhole, Search, Plus, KeyRound, ShieldCheck, Clock3, FolderClosed,
    Settings2, Cloud, CloudOff, RefreshCw, Download, Upload, Eye, EyeOff,
    Copy, Pencil, Trash2, Globe2, Check, ArrowLeft, FileKey2, X, Star,
    PanelLeftClose, PanelLeftOpen, MoreHorizontal, ChevronRight
  } from 'lucide-svelte';
  import * as vault from '$lib/kdbx';
  import * as remote from '$lib/remote';

  type View = 'all' | 'favorites' | 'codes' | 'groups';
  type Item = vault.Credential;
  let view: View = 'all';
  let query = '';
  let items: Item[] = [];
  let selected = '';
  let unlocked = false;
  let showSecret = false;
  let editing = false;
  let sidebarOpen = true;
  let showConnect = false;
  let showNewVault = false;
  let filename = 'vault.kdbx';
  let status = 'Local only';
  let busy = false;
  let error = '';
  let toast = '';
  let remoteUrl = 'https://keylite.u72mlzb.workers.dev';
  let email = '';
  let accountPassword = '';
  let signedIn = false;
  let remoteVaults: remote.RemoteVault[] = [];
  let remoteId = '';
  let remoteETag: string | null = null;
  let vaultPassword = '';
  let newVaultName = 'Personal';
  let draft = { title: '', username: '', password: '', website: '', notes: '' };
  let sidebarGroup = '';
  let fileInput: HTMLInputElement;
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;

  $: current = items.find((i) => i.id === selected);
  $: groups = [...new Set(items.map((i) => i.group).filter(Boolean))].sort();
  $: filtered = items.filter((i) => {
    const category = view === 'codes' ? false : view === 'groups' && sidebarGroup
      ? i.group === sidebarGroup : view === 'favorites' ? false : true;
    const term = query.trim().toLocaleLowerCase();
    return category && (!term || [i.title, i.username, i.website, i.group]
      .some((v) => v.toLocaleLowerCase().includes(term)));
  });

  function message(value: string) {
    toast = value;
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => toast = '', 3300);
  }
  onDestroy(() => { if (notifyTimer) clearTimeout(notifyTimer); });

  function refresh() {
    items = vault.list();
    if (selected && !items.some((i) => i.id === selected)) selected = '';
    if (!selected) selected = items[0]?.id ?? '';
  }
  function selectItem(item: Item) {
    selected = item.id;
    editing = false;
    showSecret = false;
  }
  function editItem(item: Item) {
    draft = { title: item.title, username: item.username, password: item.password, website: item.website, notes: item.notes };
    editing = true;
  }
  function saveEdit() {
    if (!current) return;
    vault.update(current, draft);
    refresh();
    editing = false;
    status = 'Unsaved changes';
    message('Changes saved to memory. Export or sync your vault.');
  }
  function newItem() {
    if (!unlocked) return;
    const id = vault.add();
    refresh();
    selected = id;
    const item = items.find((i) => i.id === id);
    if (item) editItem(item);
    status = 'Unsaved changes';
  }
  function deleteItem() {
    if (!current || !confirm('Move this password to the KDBX recycle bin?')) return;
    vault.remove(current);
    selected = '';
    editing = false;
    status = 'Unsaved changes';
    refresh();
    message('Password removed');
  }
  function lockVault() {
    vault.lock();
    items = [];
    selected = '';
    unlocked = false;
    vaultPassword = '';
    remoteETag = null;
    remoteId = '';
    editing = false;
    showSecret = false;
    status = 'Locked';
    message('Vault locked');
  }
  async function importFile(event: Event) {
    const element = event.currentTarget as HTMLInputElement;
    const file = element.files?.[0];
    if (!file) return;
    busy = true;
    error = '';
    try {
      await vault.open(await file.arrayBuffer(), vaultPassword, file.name);
      filename = file.name;
      remoteETag = null;
      remoteId = '';
      unlocked = true;
      refresh();
      status = 'Local only';
      message('Vault unlocked');
    } catch {
      error = 'Unable to open this KDBX file. Check your master password and file.';
    } finally {
      busy = false;
      element.value = '';
    }
  }
  async function createLocal() {
    if (!vaultPassword) { error = 'Enter a master password before creating a vault.'; return; }
    busy = true;
    error = '';
    try {
      vault.create(newVaultName || 'Personal', vaultPassword);
      filename = vault.filename;
      unlocked = true;
      remoteId = '';
      remoteETag = null;
      showNewVault = false;
      refresh();
      status = 'Unsaved changes';
      message('Vault created. Export a copy for safekeeping.');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create vault';
    } finally { busy = false; }
  }
  async function exportFile() {
    if (!unlocked) return;
    busy = true;
    try {
      const bytes = await vault.save();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      status = 'Saved locally';
      message('Encrypted KDBX exported');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to export vault';
    } finally { busy = false; }
  }
  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      message('Copied to clipboard');
    } catch { error = 'Clipboard access is unavailable'; }
  }
  async function connect() {
    busy = true;
    error = '';
    try {
      remote.setServer(remoteUrl);
      await remote.login(email, accountPassword);
      accountPassword = '';
      signedIn = true;
      remoteVaults = await remote.vaults();
      status = 'Connected';
      message('Connected to Keylite');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to connect';
    } finally { busy = false; }
  }
  async function disconnect() {
    await remote.logout();
    signedIn = false;
    remoteVaults = [];
    remoteId = '';
    remoteETag = null;
    status = 'Local only';
    message('Disconnected');
  }
  async function pushVault() {
    if (!unlocked || !signedIn) return;
    busy = true;
    error = '';
    try {
      let id = remoteId;
      if (!id) {
        const created = await remote.createVault(filename);
        id = created.id;
      }
      const etag = await remote.push(id, await vault.save(), remoteETag);
      remoteId = id;
      remoteETag = etag;
      remoteVaults = await remote.vaults();
      status = 'Synced';
      message('Encrypted vault synced');
    } catch (e) {
      if (e instanceof remote.ConflictError) {
        status = 'Conflict';
        error = 'The server has a newer version. Export your local edits before downloading or merging the remote vault.';
      } else error = e instanceof Error ? e.message : 'Upload failed';
    } finally { busy = false; }
  }
  async function pullVault(id: string) {
    if (!vaultPassword) { error = 'Enter the KDBX master password to open a downloaded vault.'; return; }
    if (unlocked && !confirm('Opening a remote vault replaces the current in-memory vault. Export any unsaved changes first. Continue?')) return;
    busy = true;
    error = '';
    try {
      const file = await remote.pull(id);
      const remoteItem = remoteVaults.find((v) => v.id === id);
      const name = remoteItem?.name || 'remote.kdbx';
      await vault.open(file.bytes, vaultPassword, name);
      filename = name;
      remoteId = id;
      remoteETag = file.etag;
      unlocked = true;
      refresh();
      status = 'Synced';
      showConnect = false;
      message('Remote vault opened');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to open remote vault';
    } finally { busy = false; }
  }
  function section(next: View) { view = next; sidebarGroup = ''; editing = false; }
  function initials(text: string) { return (text.trim()[0] ?? '?').toUpperCase(); }
  function titleForView() {
    if (view === 'favorites') return 'Favorites';
    if (view === 'codes') return 'Verification Codes';
    if (view === 'groups') return sidebarGroup || 'Groups';
    return 'All Passwords';
  }
</script>

<svelte:head>
  <title>Keylite — Passwords</title>
  <meta name="description" content="Your local-first KDBX password vault." />
</svelte:head>

<div class="app-shell">
  {#if sidebarOpen}
    <aside class="sidebar" aria-label="Vault navigation">
      <div class="brand"><div class="brand-icon"><LockKeyhole size={20} strokeWidth={2.5} /></div><div><strong>Keylite</strong><span>Password Manager</span></div></div>
      <div class="navigation-heading">LIBRARY</div>
      <nav>
        <button class:active={view === 'all'} on:click={() => section('all')}><KeyRound size={18}/><span>All Passwords</span><small>{items.length}</small></button>
        <button class:active={view === 'favorites'} on:click={() => section('favorites')}><Star size={18}/><span>Favorites</span></button>
        <button class:active={view === 'codes'} on:click={() => section('codes')}><ShieldCheck size={18}/><span>Verification Codes</span></button>
      </nav>
      <div class="navigation-heading group-heading">GROUPS <button title="Refresh groups" on:click={refresh}><RefreshCw size={13}/></button></div>
      <nav>
        {#each groups as group}
          <button class:active={view === 'groups' && sidebarGroup === group} on:click={() => { view = 'groups'; sidebarGroup = group; }}><FolderClosed size={17}/><span class="ellipsis">{group.split(' / ').at(-1)}</span></button>
        {:else}
          <div class="nav-hint">Your KDBX folders will appear here.</div>
        {/each}
      </nav>
      <div class="sidebar-bottom">
        <button class="sidebar-tool" on:click={() => showConnect = true}><Cloud size={17}/><span>Sync Settings</span><ChevronRight size={15}/></button>
        <button class="vault-card" on:click={() => showNewVault = true}>
          <div class="vault-mini"><FileKey2 size={21}/></div>
          <div><strong>{unlocked ? filename : 'No vault open'}</strong><span>{status}</span></div>
          <MoreHorizontal size={18}/>
        </button>
      </div>
    </aside>
  {/if}

  <section class="list-pane" aria-label="Password list">
    <header class="pane-toolbar">
      <button class="icon-button" title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} on:click={() => sidebarOpen = !sidebarOpen}>
        {#if sidebarOpen}<PanelLeftClose size={19}/>{:else}<PanelLeftOpen size={19}/>{/if}
      </button>
      <div class="toolbar-spacer"></div>
      <button class="icon-button" title="Open KDBX file" on:click={() => fileInput?.click()}><Upload size={19}/></button>
      <button class="icon-button" title="New password" disabled={!unlocked} on:click={newItem}><Plus size={21}/></button>
    </header>
    <div class="list-intro">
      <h1>{titleForView()}</h1>
      <p>{filtered.length} {filtered.length === 1 ? 'item' : 'items'} {unlocked ? 'in your vault' : 'available'}</p>
    </div>
    <label class="search-box"><Search size={17}/><input aria-label="Search passwords" bind:value={query} placeholder="Search passwords" disabled={!unlocked}/><kbd>⌘ K</kbd></label>
    <div class="item-scroll">
      {#if !unlocked}
        <div class="empty-list"><div class="empty-icon"><LockKeyhole size={25}/></div><strong>Vault locked</strong><p>Open or create a KDBX vault to view your passwords.</p></div>
      {:else if !filtered.length}
        <div class="empty-list"><div class="empty-icon"><Search size={24}/></div><strong>No passwords found</strong><p>{view === 'favorites' || view === 'codes' ? 'This category is not yet available.' : 'Try another search or add a password.'}</p></div>
      {:else}
        {#each filtered as item (item.id)}
          <button class="item" class:selected={selected === item.id} on:click={() => selectItem(item)}>
            <div class="item-avatar">{initials(item.title || item.username)}</div>
            <div class="item-copy"><strong>{item.title || 'Untitled Password'}</strong><span>{item.username || item.website || 'No username'}</span></div>
            <ChevronRight class="chevron" size={16}/>
          </button>
        {/each}
      {/if}
    </div>
    <footer class="list-footer"><span class:dot-online={signedIn} class="status-dot"></span>{signedIn ? 'Connected to Keylite' : 'Local-first · Private by design'}</footer>
  </section>

  <main class="details" aria-label="Password details">
    <header class="details-toolbar">
      <div class="breadcrumb">Passwords <ChevronRight size={14}/> <span>{current?.title || (unlocked ? filename : 'Welcome')}</span></div>
      <div class="toolbar-spacer"></div>
      <button class="pill-button" on:click={() => showConnect = true}><Cloud size={16}/><span>{signedIn ? 'Sync' : 'Connect'}</span></button>
      <button class="icon-button" title="Export KDBX vault" on:click={exportFile} disabled={!unlocked || busy}><Download size={19}/></button>
      {#if unlocked}<button class="icon-button" title="Lock vault" on:click={lockVault}><LockKeyhole size={18}/></button>{/if}
    </header>

    {#if !unlocked}
      <div class="welcome">
        <div class="welcome-icon"><LockKeyhole size={33}/></div>
        <h2>Your passwords, all in one place.</h2>
        <p>Keep your credentials in an encrypted KDBX file. Your master password never leaves this device.</p>
        <div class="unlock-card">
          <label for="master-password">Master password</label>
          <input id="master-password" type="password" bind:value={vaultPassword} placeholder="Enter your KDBX master password" autocomplete="off"/>
          <button class="primary-button" on:click={() => fileInput?.click()} disabled={busy || !vaultPassword}><FolderClosed size={17}/> Open KDBX File</button>
          <button class="secondary-button" on:click={() => showNewVault = true}>Create a new vault</button>
        </div>
      </div>
    {:else if current}
      <div class="details-inner">
        <div class="detail-head">
          <div class="hero-avatar">{initials(current.title)}</div>
          <div><h2>{current.title || 'Untitled Password'}</h2><span>{current.website || current.group || filename}</span></div>
        </div>
        <div class="detail-actions">
          {#if !editing}<button class="pill-button" on:click={() => editItem(current)}><Pencil size={15}/> Edit</button>{/if}
          <button class="pill-button neutral" on:click={exportFile}><Download size={15}/> Export vault</button>
        </div>
        {#if editing}
          <form class="edit-form" on:submit|preventDefault={saveEdit}>
            <label>Title<input bind:value={draft.title} maxlength="160" required/></label>
            <label>Username<input bind:value={draft.username} autocomplete="off"/></label>
            <label>Password<input bind:value={draft.password} type="text" autocomplete="off"/></label>
            <label>Website<input bind:value={draft.website} type="url" placeholder="https://example.com"/></label>
            <label>Notes<textarea bind:value={draft.notes} rows="4"></textarea></label>
            <div class="editor-actions"><button class="secondary-button" type="button" on:click={() => editing = false}>Cancel</button><button class="primary-button" type="submit"><Check size={16}/> Save changes</button></div>
          </form>
        {:else}
          <div class="info-card">
            <div class="field"><span>Username</span><div><strong>{current.username || '—'}</strong>{#if current.username}<button title="Copy username" on:click={() => copyText(current.username)}><Copy size={16}/></button>{/if}</div></div>
            <div class="field"><span>Password</span><div><strong class:masked={!showSecret}>{showSecret ? current.password : '••••••••••••'}</strong><button title={showSecret ? 'Hide password' : 'Show password'} on:click={() => showSecret = !showSecret}>{#if showSecret}<EyeOff size={17}/>{:else}<Eye size={17}/>{/if}</button><button title="Copy password" on:click={() => copyText(current.password)}><Copy size={16}/></button></div></div>
            <div class="field"><span>Website</span><div><strong>{current.website || '—'}</strong>{#if /^https?:\/\//.test(current.website)}<a href={current.website} target="_blank" rel="noopener noreferrer" aria-label="Open website"><Globe2 size={17}/></a>{/if}</div></div>
            {#if current.notes}<div class="field notes"><span>Notes</span><p>{current.notes}</p></div>{/if}
          </div>
          <div class="detail-meta"><FolderClosed size={15}/><span>{current.group}</span></div>
          <button class="danger-link" on:click={deleteItem}><Trash2 size={16}/> Delete Password</button>
        {/if}
      </div>
    {:else}
      <div class="welcome"><div class="welcome-icon"><KeyRound size={32}/></div><h2>Your vault is ready</h2><p>Select a password from the list or create a new one.</p><button class="primary-button" on:click={newItem}><Plus size={17}/> New Password</button></div>
    {/if}
  </main>
</div>

<input class="sr-only" type="file" accept=".kdbx,application/octet-stream" bind:this={fileInput} on:change={importFile}/>

{#if showNewVault}
  <div class="modal-backdrop" role="presentation" on:click={() => showNewVault = false} on:keydown={(event) => { if (event.key === "Escape") showNewVault = false; }}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="Create a new vault" on:click|stopPropagation on:keydown={(event) => { if (event.key === "Escape") { showConnect = false; showNewVault = false; } }}>
      <div class="modal-title"><div><h3>New Vault</h3><p>Create an encrypted KDBX database.</p></div><button class="icon-button" title="Close" on:click={() => showNewVault = false}><X size={19}/></button></div>
      <label>Vault name<input bind:value={newVaultName} maxlength="80"/></label>
      <label>Master password<input type="password" bind:value={vaultPassword} autocomplete="new-password" placeholder="Use a strong, unique passphrase"/></label>
      <p class="modal-hint">There is no password recovery. Keep your master password safe.</p>
      <button class="primary-button full" on:click={createLocal} disabled={busy || !vaultPassword}>Create Vault</button>
    </div>
  </div>
{/if}

{#if showConnect}
  <div class="modal-backdrop" role="presentation" on:click={() => showConnect = false} on:keydown={(event) => { if (event.key === "Escape") showConnect = false; }}>
    <div class="modal connect-modal" role="dialog" aria-modal="true" aria-label="Sync Settings" on:click|stopPropagation>
      <div class="modal-title"><div><h3>Keylite Sync</h3><p>Encrypted vault sync with optimistic concurrency.</p></div><button class="icon-button" title="Close" on:click={() => showConnect = false}><X size={19}/></button></div>
      {#if !signedIn}
        <label>Server URL<input type="url" bind:value={remoteUrl} placeholder="https://keylite.example.com"/></label>
        <label>Email<input type="email" bind:value={email} autocomplete="username"/></label>
        <label>Account password<input type="password" bind:value={accountPassword} autocomplete="current-password"/></label>
        <button class="primary-button full" on:click={connect} disabled={busy || !email || !accountPassword}><Cloud size={16}/> Sign in</button>
      {:else}
        <div class="connected"><div class="connected-symbol"><Check size={18}/></div><div><strong>Connected</strong><span>{email} · {remoteUrl}</span></div><button on:click={disconnect}>Sign out</button></div>
        <div class="remote-label">REMOTE VAULTS</div>
        {#each remoteVaults as remoteVault}
          <button class="remote-item" on:click={() => pullVault(remoteVault.id)} disabled={busy}>
            <div class="vault-mini"><FileKey2 size={21}/></div>
            <span><strong>{remoteVault.name}</strong><small>Revision {remoteVault.revision} · Open with master password</small></span>
            <Download size={17}/>
          </button>
        {:else}
          <p class="modal-hint">No remote vaults yet. Upload your open vault to create one.</p>
        {/each}
        <label>KDBX master password for downloads<input type="password" bind:value={vaultPassword} autocomplete="off" placeholder="Required to unlock a downloaded file"/></label>
        <button class="primary-button full" on:click={pushVault} disabled={!unlocked || busy}><Upload size={16}/> {remoteId ? 'Sync Current Vault' : 'Upload Current Vault'}</button>
        <p class="modal-hint">On conflict, Keylite refuses to overwrite the remote version. Export unsaved edits before merging.</p>
      {/if}
    </div>
  </div>
{/if}

{#if toast}<div class="toast" role="status"><Check size={17}/>{toast}</div>{/if}
{#if error}<div class="error-toast" role="alert">{error}<button on:click={() => error = ''} aria-label="Dismiss error"><X size={17}/></button></div>{/if}

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#20252e;background:#f4f5f8;-webkit-font-smoothing:antialiased}
  :global(button),:global(input),:global(textarea){font:inherit}
  :global(button){cursor:pointer}
  :global(button:disabled){opacity:.48;cursor:not-allowed}
  :global(button:focus-visible),:global(input:focus-visible),:global(textarea:focus-visible){outline:3px solid #6c9cfb;outline-offset:2px}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  .app-shell{height:100dvh;display:flex;min-width:330px;background:#fff;overflow:hidden}
  .sidebar{display:flex;flex-direction:column;flex:0 0 232px;background:linear-gradient(152deg,#f3f4f9,#edf0f7 63%,#e9eef8);border-right:1px solid #dbe0e8;padding:23px 12px 14px}
  .brand{display:flex;align-items:center;gap:11px;padding:3px 12px 34px}
  .brand-icon{background:linear-gradient(142deg,#4088e8,#3560ca);border-radius:13px;color:white;width:38px;height:38px;display:grid;place-items:center;box-shadow:0 4px 14px #4574ce3b}
  .brand strong{display:block;font-size:17px;font-weight:720;letter-spacing:-.5px}
  .brand span{display:block;font-size:10.5px;color:#7b8596;margin-top:2px}
  .navigation-heading{font-size:10px;font-weight:750;color:#98a2b2;letter-spacing:1.3px;padding:0 17px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
  .navigation-heading button{background:transparent;border:0;color:#9ca6b5;padding:0}
  .group-heading{margin-top:35px}
  nav{display:flex;flex-direction:column;gap:3px}
  nav button{display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;border:0;background:transparent;text-align:left;color:#626e80;border-radius:10px;font-size:12.8px;font-weight:560}
  nav button span{flex:1}
  nav button small{font-size:11px;color:#98a0b0}
  nav button.active{background:#dbe7fb;color:#2766be;font-weight:700}
  nav button:hover:not(.active){background:#e4e9f2}
  .nav-hint{font-size:11px;line-height:1.5;color:#9fa8b6;padding:8px 16px}
  .ellipsis{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .sidebar-bottom{margin-top:auto;display:grid;gap:10px}
  .sidebar-tool{display:flex;align-items:center;gap:10px;padding:12px 14px;border:0;background:transparent;color:#657086;font-size:12px;text-align:left}
  .sidebar-tool span{flex:1}
  .vault-card{width:100%;display:flex;align-items:center;gap:9px;background:#ffffffb5;border:1px solid #dce3ed;border-radius:12px;padding:10px;text-align:left;box-shadow:0 3px 8px #8a97a00b}
  .vault-card>div:nth-child(2){flex:1;min-width:0}
  .vault-card strong,.vault-card span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vault-card strong{font-size:11.5px}
  .vault-card span{font-size:10px;color:#8190a3;margin-top:3px}
  .vault-mini{flex:0 0 35px;width:35px;height:35px;background:#e3ebfc;color:#4e73be;display:grid;place-items:center;border-radius:9px}
  .list-pane{display:flex;flex-direction:column;flex:0 0 319px;border-right:1px solid #e7eaf0;background:#fafbfe;min-width:0}
  .pane-toolbar,.details-toolbar{height:69px;display:flex;align-items:center;gap:8px;padding:0 21px;flex-shrink:0}
  .toolbar-spacer{flex:1}
  .icon-button{width:33px;height:33px;display:grid;place-items:center;background:transparent;border:0;border-radius:8px;color:#6a778a}
  .icon-button:hover:not(:disabled){background:#e9eff9;color:#3268b5}
  .list-intro{padding:15px 24px 18px}
  .list-intro h1{font-size:23px;line-height:1.2;letter-spacing:-.8px;margin:0;font-weight:730}
  .list-intro p{color:#9ba4b2;font-size:12px;margin:8px 0 0}
  .search-box{display:flex;align-items:center;gap:9px;margin:0 18px 16px;padding:0 12px;background:#eef1f6;border-radius:9px;color:#a0a9b8;height:38px}
  .search-box input{border:0;outline:0!important;background:none;min-width:0;flex:1;font-size:12px;color:#24324a}
  .search-box input::placeholder{color:#9da7b7}
  .search-box kbd{font-size:10px;white-space:nowrap;color:#abb4c2}
  .item-scroll{flex:1;overflow:auto;padding:0 11px}
  .item{width:100%;display:flex;align-items:center;gap:12px;border:1px solid transparent;background:transparent;text-align:left;padding:11px 12px;border-radius:11px}
  .item:hover{background:#f0f3f9}
  .item.selected{background:#e7effe;border-color:#d6e5fe}
  .item-avatar{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#f1f4f9,#dce5f4);color:#5476a7;font-size:18px;font-weight:750;flex-shrink:0}
  .item.selected .item-avatar{background:#cfdef9;color:#3267b1}
  .item-copy{flex:1;min-width:0}
  .item-copy strong,.item-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .item-copy strong{font-size:12.8px;font-weight:680}
  .item-copy span{color:#8c98a7;font-size:11px;margin-top:5px}
  
  .empty-list{display:flex;flex-direction:column;align-items:center;text-align:center;padding:80px 27px;color:#56647b}
  .empty-icon{width:58px;height:58px;border-radius:18px;background:#eef2f9;display:grid;place-items:center;color:#8c9ab1;margin-bottom:17px}
  .empty-list strong{font-size:14px}
  .empty-list p{font-size:12px;line-height:1.6;color:#9ca5b3}
  .list-footer{height:49px;display:flex;align-items:center;gap:9px;color:#8d9aab;font-size:10.5px;padding:0 22px;border-top:1px solid #ebedf2}
  .status-dot{width:7px;height:7px;border-radius:50%;background:#adb8c9}
  .dot-online{background:#42b886}
  .details{flex:1;min-width:0;display:flex;flex-direction:column;background:#fff;overflow:auto}
  .details-toolbar{border-bottom:1px solid #f1f2f5;padding:0 35px}
  .breadcrumb{display:flex;align-items:center;gap:7px;color:#9ca7b7;font-size:11px;min-width:0}
  .breadcrumb span{color:#566478;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}
  .pill-button{display:inline-flex;align-items:center;gap:7px;background:#eaf2ff;color:#3b70c8;border:0;border-radius:20px;padding:9px 13px;font-weight:680;font-size:11.5px}
  .pill-button.neutral{background:#f2f4f8;color:#6c7890}
  .pill-button:hover{filter:brightness(.97)}
  .welcome{margin:auto;max-width:390px;padding:40px 26px 60px;text-align:center;display:flex;flex-direction:column;align-items:center}
  .welcome-icon{width:75px;height:75px;display:grid;place-items:center;border-radius:23px;background:linear-gradient(140deg,#e3eeff,#f0f4ff);color:#4381d7;margin-bottom:25px;box-shadow:0 12px 28px #4977c217}
  .welcome h2{font-size:23px;line-height:1.24;letter-spacing:-.8px;margin:0 0 13px;font-weight:750}
  .welcome p{max-width:330px;color:#8b98aa;font-size:12.5px;line-height:1.8;margin:0 0 26px}
  .unlock-card{display:flex;flex-direction:column;gap:12px;text-align:left;width:100%;max-width:315px}
  .unlock-card label,.modal label,.edit-form label{font-size:11px;font-weight:680;color:#66758b;display:flex;flex-direction:column;gap:7px}
  input,textarea{border:1px solid #dfe4eb;border-radius:9px;padding:12px 13px;background:#fcfdff;outline:0;min-width:0;color:#2a3242;font-size:12.5px}
  input:focus,textarea:focus{border-color:#8bafe9}
  .primary-button,.secondary-button{display:inline-flex;justify-content:center;align-items:center;gap:9px;border:0;border-radius:9px;padding:12px 15px;font-size:12.5px;font-weight:670}
  .primary-button{background:#3779d4;color:#fff;box-shadow:0 3px 12px #3b80de30}
  .primary-button:hover:not(:disabled){background:#2c68ba}
  .secondary-button{background:#f0f3f9;color:#52719e}
  .details-inner{width:100%;max-width:650px;padding:58px clamp(30px,8%,90px);margin:0 auto}
  .detail-head{display:flex;align-items:center;gap:19px}
  .hero-avatar{width:67px;height:67px;display:grid;place-items:center;background:#dce8fd;color:#4274c0;border-radius:20px;font-size:31px;font-weight:730}
  .detail-head h2{font-size:25px;letter-spacing:-.7px;margin:0 0 5px}
  .detail-head span{color:#99a4b5;font-size:12px}
  .detail-actions{display:flex;gap:9px;margin:27px 0}
  .info-card{border:1px solid #e9edf3;border-radius:15px;overflow:hidden}
  .field{padding:19px 21px;border-bottom:1px solid #edf0f4}
  .field:last-child{border-bottom:0}
  .field>span{display:block;color:#94a0b0;font-size:11px;margin-bottom:9px}
  .field>div{display:flex;align-items:center;gap:13px}
  .field strong{font-size:13px;line-height:1.4;overflow-wrap:anywhere;font-weight:610;flex:1;min-width:0}
  .field strong.masked{font-size:17px;letter-spacing:2px}
  .field button,.field a{border:0;background:transparent;padding:4px;color:#8d9bac;display:grid;place-items:center}
  .field button:hover,.field a:hover{color:#3175c8}
  .field.notes p{font-size:12.5px;line-height:1.7;white-space:pre-wrap;color:#586475;margin:0}
  .detail-meta{display:flex;align-items:center;gap:8px;color:#9ba6b7;margin:23px 3px;font-size:11px}
  .danger-link{display:flex;align-items:center;gap:8px;color:#c46e75;background:transparent;border:0;padding:12px 3px;font-size:11.5px}
  .edit-form{display:grid;gap:17px;margin:17px 0 0}
  .edit-form input,.edit-form textarea{width:100%}
  .editor-actions{display:flex;justify-content:flex-end;gap:10px}
  .modal-backdrop{position:fixed;inset:0;z-index:30;background:#1c273a66;backdrop-filter:blur(6px);display:grid;place-items:center;padding:18px}
  .modal{background:white;border:1px solid #e3e8ee;border-radius:19px;box-shadow:0 25px 80px #18243b45;padding:26px;width:min(100%,410px);display:grid;gap:16px;max-height:90vh;overflow:auto}
  .connect-modal{width:min(100%,475px)}
  .modal-title{display:flex;justify-content:space-between;align-items:flex-start}
  .modal-title h3{font-size:20px;margin:0 0 5px;letter-spacing:-.5px}
  .modal-title p{font-size:12px;color:#9ba6b7;margin:0}
  .modal-hint{font-size:11.5px;color:#95a1b0;line-height:1.65;margin:0}
  .full{width:100%}
  .connected{display:flex;align-items:center;gap:10px;background:#eef8f2;border-radius:11px;padding:12px}
  .connected-symbol{background:#d4f2df;color:#309462;border-radius:9px;width:35px;height:35px;display:grid;place-items:center}
  .connected>div:nth-child(2){min-width:0;flex:1}
  .connected strong,.connected span{display:block}
  .connected strong{font-size:12px}
  .connected span{font-size:10px;color:#799187;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px}
  .connected button{font-size:11px;color:#568171;border:0;background:none}
  .remote-label{font-size:10px;color:#9ba6b7;font-weight:700;letter-spacing:1px;margin-top:6px}
  .remote-item{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e7ebf1;border-radius:10px;background:#fff;text-align:left;width:100%}
  .remote-item span{flex:1;min-width:0}
  .remote-item strong,.remote-item small{display:block}
  .remote-item strong{font-size:12px}
  .remote-item small{font-size:10px;color:#929db0;margin-top:4px}
  .toast,.error-toast{position:fixed;z-index:80;left:50%;bottom:25px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;background:#253348;color:#fff;padding:12px 18px;border-radius:12px;font-size:12px;box-shadow:0 12px 36px #1f294034;max-width:min(95vw,600px)}
  .error-toast{background:#8d3444}
  .error-toast button{border:0;background:transparent;color:white;display:grid;place-items:center}
  @media(max-width:1030px){.sidebar{flex-basis:198px}.list-pane{flex-basis:278px}.details-inner{padding:44px 28px}.details-toolbar{padding:0 19px}}
  @media(max-width:720px){.sidebar{position:absolute;z-index:20;top:0;bottom:0;width:235px;box-shadow:8px 0 25px #25334829}.list-pane{flex:0 0 46%;min-width:180px}.details-inner{padding:35px 23px}.details-toolbar{padding:0 12px}.breadcrumb{display:none}}
  @media(max-width:510px){.list-pane{flex-basis:43%;min-width:158px}.pane-toolbar{padding:0 8px}.list-intro{padding:10px 13px}.list-intro h1{font-size:18px}.search-box{margin:0 9px 10px}.search-box kbd{display:none}.item{padding:10px 6px;gap:7px}.item-avatar{height:33px;width:33px;border-radius:9px}.item-copy strong{font-size:11px}.item-copy span{font-size:10px}.details-inner{padding:24px 14px}.detail-head{gap:8px}.hero-avatar{width:42px;height:42px;border-radius:13px;font-size:20px}.detail-head h2{font-size:18px}.detail-actions{flex-wrap:wrap}.field{padding:15px 12px}.field>div{gap:5px}.field strong{font-size:11px}.details-toolbar{gap:2px}.pill-button{padding:8px}}
</style>
