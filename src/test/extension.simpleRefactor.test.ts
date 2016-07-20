import * as assert from 'assert';

// You can import and use all API from the \'vscode\' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as path from 'path';
import * as settings from '../client/common/configSettings';
import * as fs from 'fs-extra';
import {initialize, closeActiveWindows} from './initialize';
import {execPythonFile} from '../client/common/utils';
import {extractVariable, extractMethod} from '../client/providers/simpleRefactorProvider';
import {RefactorProxy} from '../client/refactor/proxy';

let EXTENSION_DIR = path.join(__dirname, '..', '..');
let pythonSettings = settings.PythonSettings.getInstance();

const refactorSourceFile = path.join(__dirname, '..', '..', 'src', 'test', 'pythonFiles', 'refactoring', 'standAlone', 'refactor.py');
const refactorTargetFile = path.join(__dirname, '..', '..', 'out', 'test', 'pythonFiles', 'refactoring', 'standAlone', 'refactor.py');
let isPython3 = true;
let isTRAVIS = (process.env['TRAVIS'] + '') === 'true';
class MockOutputChannel implements vscode.OutputChannel {
    constructor(name: string) {
        this.name = name;
        this.output = '';
    }
    name: string;
    output: string;
    append(value: string) {
        this.output += value;
    }
    appendLine(value: string) { this.append(value); this.append('\n'); }
    clear() { }
    show(preservceFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(x?: any, y?: any): void { }
    hide() { }
    dispose() { }
}
suiteSetup(done => {
    fs.copySync(refactorSourceFile, refactorTargetFile, { clobber: true });
    initialize().then(() => {
        new Promise<string>(resolve => {
            // Support for travis
            let version = process.env['TRAVIS_PYTHON_VERSION'];
            if (typeof version === 'string') {
                return resolve(version);
            }
            // Support for local tests
            execPythonFile('python', ['--version'], __dirname, true).then(resolve);
        }).then(version => {
            isPython3 = version.indexOf('3.') >= 0;
            done();
        });
    });
});
suiteTeardown(done => {
    // deleteFile(targetPythonFileToLint).then(done, done);
    done();
});

suite('Simple Refactor', () => {
    setup(() => {
        if (fs.existsSync(refactorTargetFile)) {
            fs.unlinkSync(refactorTargetFile);
        }
        fs.copySync(refactorSourceFile, refactorTargetFile, { clobber: true });
    });
    teardown(done => {
        closeActiveWindows().then(() => {
            setTimeout(function () {
                RefactorProxy.pythonPath = null;
                done();
            }, 1000);
        });
    });

    if (!isTRAVIS) {
        function testingVariableExtraction(shouldError: boolean, pythonSettings: settings.IPythonSettings) {
            let ch = new MockOutputChannel('Python');
            let textDocument: vscode.TextDocument;
            let textEditor: vscode.TextEditor;
            let rangeOfTextToExtract = new vscode.Range(new vscode.Position(234, 29), new vscode.Position(234, 38));

            return vscode.workspace.openTextDocument(refactorTargetFile).then(document => {
                textDocument = document;
                return vscode.window.showTextDocument(textDocument);
            }).then(editor => {
                editor.selections = [new vscode.Selection(rangeOfTextToExtract.start, rangeOfTextToExtract.end)];
                editor.selection = new vscode.Selection(rangeOfTextToExtract.start, rangeOfTextToExtract.end);
                textEditor = editor;
                return;
            }).then(() => {
                return extractVariable(EXTENSION_DIR, textEditor, rangeOfTextToExtract, ch, path.dirname(refactorTargetFile), false, pythonSettings).then(() => {
                    if (shouldError) {
                        // Wait a minute this shouldn't work, what's going on
                        throw new Error('This should fail, but seems to have worked');
                    }
                    assert.equal(ch.output.length, 0, 'Output channel is not empty');
                    assert.equal(textDocument.lineAt(234).text.trim().indexOf('newvariable'), 0, 'New Variable not created');
                    assert.equal(textDocument.lineAt(234).text.trim().endsWith('= "STARTED"'), true, 'Started Text Assigned to variable');
                    assert.equal(textDocument.lineAt(235).text.indexOf('(newvariable') >= 0, true, 'New Variable not being used');
                }).catch(error => {
                    if (shouldError) {
                        // Wait a minute this shouldn't work, what's going on
                        assert.equal(true, true, 'Error raised as expected');
                        return;
                    }

                    if (typeof error === 'object' && error.message) {
                        throw error;
                    }
                    else {
                        throw new Error(error);
                    }
                });
            }, error => {
                if (shouldError) {
                    // Wait a minute this shouldn't work, what's going on
                    assert.equal(true, true, 'Error raised as expected');
                }
                else {
                    assert.fail(error + '', null, 'Variable extraction failed\n' + ch.output);
                    if (typeof error === 'object' && error.message) {
                        throw error;
                    }
                    else {
                        throw new Error(error);
                    }
                }
            });
        }

        test('Extract Variable', done => {
            testingVariableExtraction(false, pythonSettings).then(() => done(), done);
        });

        test('Extract Variable will try to find Python 2.x', done => {
            let clonedSettings = JSON.parse(JSON.stringify(pythonSettings));
            clonedSettings.python2Path = 'python3';
            testingVariableExtraction(false, clonedSettings).then(() => done(), done);
        });

        test('Extract Variable will not work in Python 3.x', done => {
            let clonedSettings = JSON.parse(JSON.stringify(pythonSettings));
            clonedSettings.pythonPath = 'python3';
            clonedSettings.python2Path = 'python3';
            testingVariableExtraction(true, clonedSettings).then(() => done(), done);
        });
    }
});