import { KernelManagerImpl } from './kernel-manager';
import { Kernel } from './kernel';
import * as vscode from 'vscode';
import { JupyterDisplay } from './display/main';
import { KernelStatus } from './display/kernelStatus';
import { Commands, PythonLanguage } from '../common/constants';
import { JupyterCodeLensProvider } from './editorIntegration/codeLensProvider';
import { JupyterSymbolProvider } from './editorIntegration/symbolProvider';
import { formatErrorForLogging } from '../common/utils';
import { Documentation } from '../common/constants';
import * as telemetryHelper from '../common/telemetry';
import * as telemetryContracts from '../common/telemetryContracts';
import * as main from './jupyter_client/main';
import { KernelRestartedError, KernelShutdownError } from './common/errors';

// Todo: Refactor the error handling and displaying of messages

export class Jupyter extends vscode.Disposable {
    public kernelManager: KernelManagerImpl;
    public kernel: Kernel = null;
    private status: KernelStatus;
    private disposables: vscode.Disposable[];
    private display: JupyterDisplay;
    private codeLensProvider: JupyterCodeLensProvider;
    constructor(private outputChannel: vscode.OutputChannel) {
        super(() => { });
        this.disposables = [];
        this.registerCommands();
        this.registerKernelCommands();
    }
    activate(rootPath: string) {
        const jupyterClient = new main.JupyterClientAdapter(this.outputChannel, rootPath);
        this.kernelManager = new KernelManagerImpl(this.outputChannel, jupyterClient);
        this.disposables.push(this.kernelManager);
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(this.onEditorChanged.bind(this)));
        this.codeLensProvider = new JupyterCodeLensProvider();
        this.disposables.push(vscode.languages.registerCodeLensProvider(PythonLanguage, this.codeLensProvider));
        this.disposables.push(vscode.languages.registerDocumentSymbolProvider(PythonLanguage, new JupyterSymbolProvider()));
        this.status = new KernelStatus();
        this.disposables.push(this.status);
        this.display = new JupyterDisplay(this.codeLensProvider);
        this.disposables.push(this.display);

        // This happend when user changes it from status bar
        this.kernelManager.on('kernelChanged', (kernel: Kernel, language: string) => {
            if (this.kernel !== kernel && (this.kernel && this.kernel.kernelSpec.language === kernel.kernelSpec.language)) {
                this.onKernelChanged(kernel);
            }
        });
    }
    public hasCodeCells(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            this.codeLensProvider.provideCodeLenses(document, token).then(codeLenses => {
                resolve(Array.isArray(codeLenses) && codeLenses.length > 0);
            }, reason => {
                console.error('Failed to detect code cells in document');
                console.error(reason);
                resolve(false);
            });
        });
    }
    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
    private onEditorChanged(editor: vscode.TextEditor) {
        if (!editor || !editor.document) {
            return;
        }
        const kernel = this.kernelManager.getRunningKernelFor(editor.document.languageId);
        if (this.kernel !== kernel) {
            return this.onKernelChanged(kernel);
        }
    }
    private onKernalStatusChangeHandler: vscode.Disposable;
    onKernelChanged(kernel?: Kernel) {
        if (this.onKernalStatusChangeHandler) {
            this.onKernalStatusChangeHandler.dispose();
            this.onKernalStatusChangeHandler = null;
        }
        if (kernel) {
            this.onKernalStatusChangeHandler = kernel.onStatusChange(statusInfo => {
                this.status.setKernelStatus(statusInfo[1]);
            });
        }
        this.kernel = kernel;
        this.status.setActiveKernel(this.kernel ? this.kernel.kernelSpec : null);
    }
    executeCode(code: string, language: string): Promise<any> {
        // const m = new main.JupyterClient(this.outputChannel);
        // m.start();
        // return Promise.resolve();
        telemetryHelper.sendTelemetryEvent(telemetryContracts.Jupyter.Usage);

        if (this.kernel && this.kernel.kernelSpec.language === language) {
            return this.executeAndDisplay(this.kernel, code).catch(reason => {
                const message = typeof reason === 'string' ? reason : reason.message;
                vscode.window.showErrorMessage(message);
                this.outputChannel.appendLine(formatErrorForLogging(reason));
            });
        }
        return this.kernelManager.startKernelFor(language)
            .then(kernel => {
                if (kernel) {
                    this.onKernelChanged(kernel);
                    return this.executeAndDisplay(kernel, code);
                }
            }).catch(reason => {
                const message = typeof reason === 'string' ? reason : reason.message;
                this.outputChannel.appendLine(formatErrorForLogging(reason));
                vscode.window.showErrorMessage(message, 'Help', 'View Errors').then(item => {
                    if (item === 'Help') {
                        vscode.commands.executeCommand('python.displayHelp', Documentation.Jupyter.Setup);
                    }
                    if (item === 'View Errors') {
                        this.outputChannel.show();
                    }
                });
            });
    }
    private executeAndDisplay(kernel: Kernel, code: string) {
        return this.executeCodeInKernel(kernel, code).then(result => {
            // No results to display
            if (result.length === 0) {
                return;
            }
            return this.display.showResults(result);
        });
    }
    private executeCodeInKernel(kernel: Kernel, code: string): Promise<any[]> {
        return new Promise<any[]>((resolve, reject) => {
            let responses = [];
            return kernel.execute(code).subscribe(result => {
                if (typeof result.data['text/html'] === 'string') {
                    result.data['text/html'] = result.data['text/html'].replace(/<\/script>/g, '</scripts>');
                }
                responses.push(result.data);
            }, reason => {
                if (reason instanceof KernelRestartedError || reason instanceof KernelShutdownError) {
                    return resolve([]);
                }
                reject(reason);
            }, () => {
                resolve(responses);
            });
        });
    }
    executeSelection() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || !activeEditor.document) {
            return;
        }
        let code = '';
        if (activeEditor.selection.isEmpty) {
            code = activeEditor.document.lineAt(activeEditor.selection.start.line).text;
        }
        else {
            code = activeEditor.document.getText(activeEditor.selection);
        }
        this.executeCode(code, activeEditor.document.languageId);
    }
    private registerCommands() {
        this.disposables.push(vscode.commands.registerCommand(Commands.Jupyter.ExecuteRangeInKernel, (document: vscode.TextDocument, range: vscode.Range) => {
            if (!document || !range || range.isEmpty) {
                return Promise.resolve();
            }
            const code = document.getText(range);
            return this.executeCode(code, document.languageId);
        }));
        this.disposables.push(vscode.commands.registerCommand(Commands.Jupyter.ExecuteSelectionOrLineInKernel,
            this.executeSelection.bind(this)));
    }
    private registerKernelCommands() {
        this.disposables.push(vscode.commands.registerCommand(Commands.Jupyter.Kernel.Kernel_Interrupt, () => {
            this.kernel.interrupt();
        }));
        this.disposables.push(vscode.commands.registerCommand(Commands.Jupyter.Kernel.Kernel_Restart, () => {
            this.kernelManager.restartRunningKernelFor(this.kernel.kernelSpec.language).then(kernel => {
                this.onKernelChanged(kernel);
            });
        }));
        this.disposables.push(vscode.commands.registerCommand(Commands.Jupyter.Kernel.Kernel_Shut_Down, () => {
            this.kernel.shutdown();
            this.onKernelChanged();
        }));
    }
};