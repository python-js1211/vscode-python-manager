//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// Place this right on top
import { initialize } from './initialize';
// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { JupyterClient } from '../client/jupyter/jupyter_client/main';

// Defines a Mocha test suite to group tests of similar kind together
suite('JupyterClient', () => {
    test('Ping (Process and Socket)', done => {
        const jupyter = new JupyterClient(vscode.window.createOutputChannel('Python'), __dirname);
        jupyter.start().then(() => {
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Starting Jupyter failed', '');
            done();
        })
    });
});