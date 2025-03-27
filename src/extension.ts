// The module 'vscode' contains the VS Code extensibility API
import * as path from 'path';
import * as vscode from 'vscode';

// Interface for storing flagged file information
interface FlaggedFile {
    uri: vscode.Uri;
    comment: string;
    parentId: string | null;
}

interface FlagFolder {
    id: string;
    name: string;
    parentId: string | null;
}

// Tree items for flag organization
class FlagFolderItem extends vscode.TreeItem {
    constructor(public readonly folder: FlagFolder) {
        super(folder.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'flagFolder';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

// Tree data provider for the flagged files view
class FlaggedFilesProvider
    implements
        vscode.TreeDataProvider<FlaggedFileItem | FlagFolderItem>,
        vscode.TreeDragAndDropController<FlaggedFileItem | FlagFolderItem>
{
    private _onDidChangeTreeData: vscode.EventEmitter<FlaggedFileItem | FlagFolderItem | undefined | null | void> =
        new vscode.EventEmitter<FlaggedFileItem | FlagFolderItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FlaggedFileItem | FlagFolderItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private flaggedFiles: Map<string, FlaggedFile> = new Map();
    private folders: Map<string, FlagFolder> = new Map();
    private context: vscode.ExtensionContext;

    // Implement drag and drop
    dropMimeTypes = ['application/vnd.code.tree.flaggedFiles', 'text/uri-list'];
    dragMimeTypes = ['application/vnd.code.tree.flaggedFiles'];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadState();
    }

    private loadState(): void {
        const storedData = this.context.globalState.get<{
            files: { [key: string]: { uri: string; comment: string; parentId: string | null } };
            folders: { [key: string]: { id: string; name: string; parentId: string | null } };
        }>('flagItData', { files: {}, folders: {} });

        // Load folders
        Object.values(storedData.folders).forEach((folder) => {
            this.folders.set(folder.id, folder);
        });

        // Load files
        Object.entries(storedData.files).forEach(([key, value]) => {
            this.flaggedFiles.set(key, {
                uri: vscode.Uri.parse(value.uri),
                comment: value.comment,
                parentId: value.parentId,
            });
        });

        this.updateContext();
    }

    private saveState(): void {
        const filesToStore: { [key: string]: { uri: string; comment: string; parentId: string | null } } = {};
        this.flaggedFiles.forEach((file, key) => {
            filesToStore[key] = {
                uri: file.uri.toString(),
                comment: file.comment,
                parentId: file.parentId,
            };
        });

        const foldersToStore: { [key: string]: FlagFolder } = {};
        this.folders.forEach((folder, key) => {
            foldersToStore[key] = folder;
        });

        this.context.globalState.update('flagItData', {
            files: filesToStore,
            folders: foldersToStore,
        });
    }

    async handleDrop(
        target: FlaggedFileItem | FlagFolderItem | undefined,
        sources: vscode.DataTransfer,
    ): Promise<void> {
        // Determine target folder ID based on what we dropped onto
        let targetParentId: string | null = null;
        if (target instanceof FlagFolderItem) {
            targetParentId = target.folder.id;
        } else if (target instanceof FlaggedFileItem) {
            // If dropped on a file, put it in the same folder as that file
            const targetFile = this.flaggedFiles.get(target.uri.toString());
            if (targetFile) {
                targetParentId = targetFile.parentId;
            }
        }

        // First try handling drops from our own tree (internal drag and drop)
        const transferredItems = sources.get('application/vnd.code.tree.flaggedFiles')?.value;
        if (transferredItems?.length) {
            for (const item of transferredItems) {
                if (item.type === 'file') {
                    const file = this.flaggedFiles.get(item.uri);
                    if (file) {
                        file.parentId = targetParentId;
                    }
                } else if (item.type === 'folder') {
                    const folder = this.folders.get(item.id);
                    if (folder && !this.wouldCreateCycle(folder.id, targetParentId)) {
                        folder.parentId = targetParentId;
                    }
                }
            }

            this.saveState();
            this.refresh();
            return;
        }

        // Handle drops from editor tabs (will be in text/uri-list format)
        const uriList = sources.get('text/uri-list')?.value;
        if (uriList) {
            // text/uri-list format is URI per line, potentially with comments prefixed with #
            const uris = uriList
                .split('\n')
                .map((line: string) => line.trim())
                .filter((line: string) => line && !line.startsWith('#'))
                .map((uri: string) => {
                    try {
                        return vscode.Uri.parse(uri);
                    } catch {
                        return null;
                    }
                })
                .filter((uri: unknown): uri is vscode.Uri => uri !== null);

            if (uris.length > 0) {
                for (const uri of uris) {
                    // Check if file is already flagged
                    const existingFlag = this.flaggedFiles.get(uri.toString());
                    if (existingFlag) {
                        // If already flagged, just move it to the target folder
                        existingFlag.parentId = targetParentId;
                    } else {
                        // Otherwise, prompt for a comment and flag it
                        const comment = await vscode.window.showInputBox({
                            placeHolder: 'Add a comment (optional)',
                            prompt: `Add an optional comment for ${path.basename(uri.fsPath)}`,
                        });
                        this.flaggedFiles.set(uri.toString(), {
                            uri,
                            comment: comment || '',
                            parentId: targetParentId,
                        });
                    }
                }

                this.saveState();
                this.refresh();
                vscode.window.showInformationMessage(`File${uris.length > 1 ? 's' : ''} flagged successfully`);
            }
        }
    }

    async handleDrag(
        source: readonly (FlaggedFileItem | FlagFolderItem)[],
        dataTransfer: vscode.DataTransfer,
    ): Promise<void> {
        const items = source
            .map((item) => {
                if (item instanceof FlaggedFileItem) {
                    return { type: 'file', uri: item.uri.toString() };
                } else if (item instanceof FlagFolderItem) {
                    return { type: 'folder', id: item.folder.id };
                }
                return null;
            })
            .filter(Boolean);

        dataTransfer.set('application/vnd.code.tree.flaggedFiles', new vscode.DataTransferItem(items));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
        this.updateContext();
    }

    private updateContext(): void {
        vscode.commands.executeCommand('setContext', 'flag-it:hasFlaggedFiles', this.flaggedFiles.size > 0);
    }

    private isFileInWorkspace(uri: vscode.Uri): boolean {
        if (!vscode.workspace.workspaceFolders) {
            return false;
        }
        return vscode.workspace.workspaceFolders.some((folder) => uri.fsPath.startsWith(folder.uri.fsPath));
    }

    getTreeItem(element: FlaggedFileItem | FlagFolderItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FlaggedFileItem | FlagFolderItem): Thenable<Array<FlaggedFileItem | FlagFolderItem>> {
        if (this.flaggedFiles.size === 0 && this.folders.size === 0) {
            return Promise.resolve([]);
        }

        if (!element) {
            const items: Array<FlaggedFileItem | FlagFolderItem> = [];

            // Add root folders
            this.folders.forEach((folder) => {
                if (!folder.parentId) {
                    items.push(new FlagFolderItem(folder));
                }
            });

            // Add root files (files not in any folder)
            this.flaggedFiles.forEach((file) => {
                if (!file.parentId) {
                    items.push(new FlaggedFileItem(file.uri, file.comment, this.context));
                }
            });

            return Promise.resolve(items);
        }

        if (element instanceof FlagFolderItem) {
            const items: Array<FlaggedFileItem | FlagFolderItem> = [];
            this.folders.forEach((folder) => {
                if (folder.parentId === element.folder.id) {
                    items.push(new FlagFolderItem(folder));
                }
            });
            this.flaggedFiles.forEach((file) => {
                if (file.parentId === element.folder.id) {
                    items.push(new FlaggedFileItem(file.uri, file.comment, this.context));
                }
            });
            return Promise.resolve(items);
        }

        return Promise.resolve([]);
    }

    getFlaggedFiles(): Map<string, FlaggedFile> {
        return this.flaggedFiles;
    }

    addFlaggedFile(uri: vscode.Uri, comment: string, parentId: string | null = null): void {
        this.flaggedFiles.set(uri.toString(), { uri, comment, parentId });
        this.saveState();
        this.refresh();
    }

    removeFlaggedFile(uri: vscode.Uri): void {
        this.flaggedFiles.delete(uri.toString());
        this.saveState();
        this.refresh();
    }

    clearAllFlags(): void {
        this.flaggedFiles.clear();
        this.saveState();
        this.refresh();
    }

    updateComment(uri: vscode.Uri, comment: string): void {
        const file = this.flaggedFiles.get(uri.toString());
        if (file) {
            file.comment = comment;
            this.saveState();
            this.refresh();
        }
    }

    createFolder(name: string, parentId: string | null = null): void {
        const id = crypto.randomUUID();
        this.folders.set(id, { id, name, parentId });
        this.saveState();
        this.refresh();
    }

    renameFolder(folderId: string, newName: string): void {
        const folder = this.folders.get(folderId);
        if (folder) {
            folder.name = newName;
            this.saveState();
            this.refresh();
        }
    }

    deleteFolder(folderId: string): void {
        // Move all files from this folder to its parent
        const folder = this.folders.get(folderId);
        if (folder) {
            const parentId = folder.parentId;

            // Update files in this folder
            this.flaggedFiles.forEach((file) => {
                if (file.parentId === folderId) {
                    file.parentId = parentId;
                }
            });

            // Update subfolders
            this.folders.forEach((subfolder) => {
                if (subfolder.parentId === folderId) {
                    subfolder.parentId = parentId;
                }
            });

            // Delete the folder
            this.folders.delete(folderId);
            this.saveState();
            this.refresh();
        }
    }

    private wouldCreateCycle(folderId: string, newParentId: string | null): boolean {
        if (!newParentId) {
            return false;
        }

        let currentId = newParentId;
        while (currentId) {
            if (currentId === folderId) {
                return true;
            }
            const parent = this.folders.get(currentId);
            if (!parent?.parentId) {
                break;
            }
            currentId = parent.parentId;
        }
        return false;
    }

    private saveFlaggedFiles(): void {
        // Convert Map to object for storage
        const filesToStore: { [key: string]: { uri: string; comment: string } } = {};
        this.flaggedFiles.forEach((file, key) => {
            filesToStore[key] = {
                uri: file.uri.toString(),
                comment: file.comment,
            };
        });
        this.context.globalState.update('flaggedFiles', filesToStore);
    }
}

// Tree item representing a flagged file
class FlaggedFileItem extends vscode.TreeItem {
    constructor(
        public readonly uri: vscode.Uri,
        public readonly comment: string,
        private context: vscode.ExtensionContext,
    ) {
        super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);

        this.tooltip = `${this.comment ? this.comment + '\n' : ''}${uri.fsPath}`;
        this.description = comment || 'No comment';

        // Set the command to open the file when clicking on the tree item
        this.command = {
            command: 'flag-it.openFlaggedFile',
            title: 'Open Flagged File',
            arguments: [this.uri],
        };

        // Set icon and context value
        this.iconPath = new vscode.ThemeIcon('flag');
        this.contextValue = 'flaggedFile';

        // Check if file is in workspace and apply different styling if it's not
        if (!this.isFileInWorkspace(uri)) {
            this.resourceUri = uri; // This enables the "dimmed" appearance
            this.description = `${this.description} (External)`;
            this.tooltip = `${this.tooltip}\n(File is outside workspace)`;
        }
    }

    private isFileInWorkspace(uri: vscode.Uri): boolean {
        if (!vscode.workspace.workspaceFolders) {
            return false;
        }
        return vscode.workspace.workspaceFolders.some((folder) => uri.fsPath.startsWith(folder.uri.fsPath));
    }
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "flag-it" is now active!');

    // Update the context when files are flagged/unflagged
    context.subscriptions.push(
        vscode.commands.registerCommand('flag-it.updateContext', () => {
            const hasFlaggedFiles = flaggedFilesProvider.getFlaggedFiles().size > 0;
            vscode.commands.executeCommand('setContext', 'flag-it:hasFlaggedFiles', hasFlaggedFiles);
        }),
    );

    // Initialize context for view switching
    const storedFiles = context.globalState.get<{ [key: string]: FlaggedFile }>('flaggedFiles', {});
    const hasFlaggedFiles = Object.keys(storedFiles).length > 0;
    vscode.commands.executeCommand('setContext', 'flag-it:hasFlaggedFiles', hasFlaggedFiles);

    // Create the tree data provider
    const flaggedFilesProvider = new FlaggedFilesProvider(context);
    const treeView = vscode.window.createTreeView('flaggedFiles', {
        treeDataProvider: flaggedFilesProvider,
        dragAndDropController: flaggedFilesProvider,
    });

    // Save section position when it changes
    treeView.onDidChangeVisibility(() => {
        const config = vscode.workspace.getConfiguration('flag-it');
        const currentOrder = config.get('externalFilesSectionOrder');
        if (currentOrder !== treeView.selection.length) {
            config.update('externalFilesSectionOrder', treeView.selection.length, true);
        }
    });

    // Register command to flag a file
    const flagFileCommand = vscode.commands.registerCommand('flag-it.flagFile', async (uri?: vscode.Uri) => {
        // If uri is not provided (command palette), use the active editor
        if (!uri) {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('No file is open to flag');
                return;
            }
            uri = activeEditor.document.uri;
        }

        // Check if file is saved
        if (uri.scheme === 'untitled') {
            vscode.window.showErrorMessage('Cannot flag unsaved files. Please save the file first.');
            return;
        }

        // Ask for a comment
        const comment = await vscode.window.showInputBox({
            placeHolder: 'Add a comment (optional)',
            prompt: 'Add an optional comment for this flagged file',
        });

        // Add to flagged files
        flaggedFilesProvider.addFlaggedFile(uri, comment || '');
        vscode.window.showInformationMessage(`Flagged: ${path.basename(uri.fsPath)}`);
    });

    // Register command to open a flagged file
    const openFlaggedFileCommand = vscode.commands.registerCommand(
        'flag-it.openFlaggedFile',
        async (uri: vscode.Uri) => {
            try {
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document);
            } catch {
                vscode.window.showErrorMessage(`Failed to open file: ${uri.fsPath}`);
            }
        },
    );

    // Register command to remove flag from a file
    const removeFlagCommand = vscode.commands.registerCommand(
        'flag-it.removeFlagFromFile',
        async (item: FlaggedFileItem) => {
            if (item) {
                flaggedFilesProvider.removeFlaggedFile(item.uri);
                vscode.window.showInformationMessage(`Flag removed: ${path.basename(item.uri.fsPath)}`);
            }
        },
    );

    // Register command to edit a flag's comment
    const editCommentCommand = vscode.commands.registerCommand('flag-it.editComment', async (item: FlaggedFileItem) => {
        if (item) {
            const newComment = await vscode.window.showInputBox({
                placeHolder: 'Add a comment',
                prompt: 'Edit the comment for this flagged file',
                value: item.comment,
            });

            if (newComment !== undefined) {
                // Check if user canceled
                flaggedFilesProvider.updateComment(item.uri, newComment);
            }
        }
    });

    // Register command to clear all flags
    const clearAllFlagsCommand = vscode.commands.registerCommand('flag-it.clearAllFlags', async () => {
        const confirmation = await vscode.window.showWarningMessage(
            'Are you sure you want to remove all flags?',
            { modal: true },
            'Yes',
            'No',
        );

        if (confirmation === 'Yes') {
            flaggedFilesProvider.clearAllFlags();
            vscode.window.showInformationMessage('All flags have been cleared');
        }
    });

    // Register folder management commands
    const createFolderCommand = vscode.commands.registerCommand(
        'flag-it.createFolder',
        async (item?: FlagFolderItem) => {
            const name = await vscode.window.showInputBox({
                placeHolder: 'Folder name',
                prompt: 'Enter a name for the new folder',
            });

            if (name) {
                const parentId = item?.folder?.id ?? null;
                flaggedFilesProvider.createFolder(name, parentId);
            }
        },
    );

    const renameFolderCommand = vscode.commands.registerCommand(
        'flag-it.renameFolder',
        async (item: FlagFolderItem) => {
            const newName = await vscode.window.showInputBox({
                placeHolder: 'Folder name',
                prompt: 'Enter a new name for the folder',
                value: item.folder.name,
            });

            if (newName) {
                flaggedFilesProvider.renameFolder(item.folder.id, newName);
            }
        },
    );

    const deleteFolderCommand = vscode.commands.registerCommand(
        'flag-it.deleteFolder',
        async (item: FlagFolderItem) => {
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to delete the folder "${item.folder.name}"? Files will be moved to the parent folder.`,
                { modal: true },
                'Yes',
                'No',
            );

            if (confirmation === 'Yes') {
                flaggedFilesProvider.deleteFolder(item.folder.id);
            }
        },
    );

    // Push all disposables to the context subscriptions
    context.subscriptions.push(
        flagFileCommand,
        openFlaggedFileCommand,
        removeFlagCommand,
        editCommentCommand,
        clearAllFlagsCommand,
        createFolderCommand,
        renameFolderCommand,
        deleteFolderCommand,
        treeView,
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
