// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// tslint:disable:max-func-body-length no-any

import { expect } from 'chai';
import * as path from 'path';
import { parse } from 'semver';
import { anything, instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { Disposable } from 'vscode';
import { TerminalManager } from '../../../client/common/application/terminalManager';
import { WorkspaceService } from '../../../client/common/application/workspace';
import '../../../client/common/extensions';
import {
    IFileSystem, IPlatformService
} from '../../../client/common/platform/types';
import {
    IProcessService, IProcessServiceFactory
} from '../../../client/common/process/types';
import { Bash } from '../../../client/common/terminal/environmentActivationProviders/bash';
import { CommandPromptAndPowerShell } from '../../../client/common/terminal/environmentActivationProviders/commandPrompt';
import {
    CondaActivationCommandProvider
} from '../../../client/common/terminal/environmentActivationProviders/condaActivationProvider';
import { PipEnvActivationCommandProvider } from '../../../client/common/terminal/environmentActivationProviders/pipEnvActivationProvider';
import { PyEnvActivationCommandProvider } from '../../../client/common/terminal/environmentActivationProviders/pyenvActivationProvider';
import { TerminalHelper } from '../../../client/common/terminal/helper';
import {
    ITerminalActivationCommandProvider, TerminalShellType
} from '../../../client/common/terminal/types';
import {
    IConfigurationService, IDisposableRegistry,
    IPythonSettings, ITerminalSettings
} from '../../../client/common/types';
import { getNamesAndValues } from '../../../client/common/utils/enum';
import { ICondaService } from '../../../client/interpreter/contracts';
import { InterpreterService } from '../../../client/interpreter/interpreterService';
import { IServiceContainer } from '../../../client/ioc/types';

suite('Terminal Environment Activation conda', () => {
    let terminalHelper: TerminalHelper;
    let disposables: Disposable[] = [];
    let terminalSettings: TypeMoq.IMock<ITerminalSettings>;
    let platformService: TypeMoq.IMock<IPlatformService>;
    let fileSystem: TypeMoq.IMock<IFileSystem>;
    let pythonSettings: TypeMoq.IMock<IPythonSettings>;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let processService: TypeMoq.IMock<IProcessService>;
    let procServiceFactory: TypeMoq.IMock<IProcessServiceFactory>;
    let condaService: TypeMoq.IMock<ICondaService>;
    let conda: string;
    let bash: ITerminalActivationCommandProvider;

    setup(() => {
        conda = 'conda';
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        disposables = [];
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(IDisposableRegistry), TypeMoq.It.isAny())).returns(() => disposables);

        fileSystem = TypeMoq.Mock.ofType<IFileSystem>();
        platformService = TypeMoq.Mock.ofType<IPlatformService>();
        processService = TypeMoq.Mock.ofType<IProcessService>();
        condaService = TypeMoq.Mock.ofType<ICondaService>();
        condaService.setup(c => c.getCondaFile()).returns(() => Promise.resolve(conda));
        bash = mock(Bash);

        processService.setup((x: any) => x.then).returns(() => undefined);
        procServiceFactory = TypeMoq.Mock.ofType<IProcessServiceFactory>();
        procServiceFactory.setup(p => p.create(TypeMoq.It.isAny())).returns(() => Promise.resolve(processService.object));

        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(IPlatformService), TypeMoq.It.isAny())).returns(() => platformService.object);
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(IFileSystem), TypeMoq.It.isAny())).returns(() => fileSystem.object);
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(IProcessServiceFactory), TypeMoq.It.isAny())).returns(() => procServiceFactory.object);
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(ICondaService), TypeMoq.It.isAny())).returns(() => condaService.object);

        const configService = TypeMoq.Mock.ofType<IConfigurationService>();
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(IConfigurationService))).returns(() => configService.object);
        pythonSettings = TypeMoq.Mock.ofType<IPythonSettings>();
        configService.setup(c => c.getSettings(TypeMoq.It.isAny())).returns(() => pythonSettings.object);

        terminalSettings = TypeMoq.Mock.ofType<ITerminalSettings>();
        pythonSettings.setup(s => s.terminal).returns(() => terminalSettings.object);

        terminalHelper = new TerminalHelper(platformService.object,
            instance(mock(TerminalManager)), instance(mock(WorkspaceService)),
            condaService.object,
            instance(mock(InterpreterService)),
            configService.object,
            new CondaActivationCommandProvider(serviceContainer.object),
            instance(bash),
            mock(CommandPromptAndPowerShell),
            mock(PyEnvActivationCommandProvider),
            mock(PipEnvActivationCommandProvider));

    });
    teardown(() => {
        disposables.forEach(disposable => {
            if (disposable) {
                disposable.dispose();
            }
        });
    });

    test('Ensure no activation commands are returned if the feature is disabled', async () => {
        terminalSettings.setup(t => t.activateEnvironment).returns(() => false);

        const activationCommands = await terminalHelper.getEnvironmentActivationCommands(TerminalShellType.bash, undefined);
        expect(activationCommands).to.equal(undefined, 'Activation commands should be undefined');
    });

    test('Conda activation for fish escapes spaces in conda filename', async () => {
        conda = 'path to conda';
        const envName = 'EnvA';
        const pythonPath = 'python3';
        platformService.setup(p => p.isWindows).returns(() => false);
        condaService.setup(c => c.getCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve({ name: envName, path: path.dirname(pythonPath) }));
        const expected = ['"path to conda" activate EnvA'];

        const provider = new CondaActivationCommandProvider(serviceContainer.object);
        const activationCommands = await provider.getActivationCommands(undefined, TerminalShellType.fish);

        expect(activationCommands).to.deep.equal(expected, 'Incorrect Activation command');
    });

    test('Conda activation on bash uses "source" before 4.4.0', async () => {
        const envName = 'EnvA';
        const pythonPath = 'python3';
        const condaPath = path.join('a', 'b', 'c', 'conda');
        platformService.setup(p => p.isWindows).returns(() => false);
        condaService.reset();
        condaService.setup(c => c.getCondaEnvironment(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({
                name: envName,
                path: path.dirname(pythonPath)
            }));
        condaService.setup(c => c.getCondaFile())
            .returns(() => Promise.resolve(condaPath));
        condaService.setup(c => c.getCondaVersion())
            .returns(() => Promise.resolve(parse('4.3.1', true)!));
        const expected = [`source ${path.join(path.dirname(condaPath), 'activate').fileToCommandArgument()} EnvA`];

        const provider = new CondaActivationCommandProvider(serviceContainer.object);
        const activationCommands = await provider.getActivationCommands(undefined, TerminalShellType.bash);

        expect(activationCommands).to.deep.equal(expected, 'Incorrect Activation command');
    });

    test('Conda activation on bash uses "conda" after 4.4.0', async () => {
        const envName = 'EnvA';
        const pythonPath = 'python3';
        const condaPath = path.join('a', 'b', 'c', 'conda');
        platformService.setup(p => p.isWindows).returns(() => false);
        condaService.reset();
        condaService.setup(c => c.getCondaEnvironment(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({
                name: envName,
                path: path.dirname(pythonPath)
            }));
        condaService.setup(c => c.getCondaFile())
            .returns(() => Promise.resolve(condaPath));
        condaService.setup(c => c.getCondaVersion())
            .returns(() => Promise.resolve(parse('4.4.0', true)!));
        const expected = [`source ${path.join(path.dirname(condaPath), 'activate').fileToCommandArgument()} EnvA`];

        const provider = new CondaActivationCommandProvider(serviceContainer.object);
        const activationCommands = await provider.getActivationCommands(undefined, TerminalShellType.bash);

        expect(activationCommands).to.deep.equal(expected, 'Incorrect Activation command');
    });

    async function expectNoCondaActivationCommandForPowershell(isWindows: boolean, isOsx: boolean, isLinux: boolean, pythonPath: string, shellType: TerminalShellType, hasSpaceInEnvironmentName = false) {
        terminalSettings.setup(t => t.activateEnvironment).returns(() => true);
        platformService.setup(p => p.isLinux).returns(() => isLinux);
        platformService.setup(p => p.isWindows).returns(() => isWindows);
        platformService.setup(p => p.isMac).returns(() => isOsx);
        condaService.setup(c => c.isCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve(true));
        pythonSettings.setup(s => s.pythonPath).returns(() => pythonPath);
        const envName = hasSpaceInEnvironmentName ? 'EnvA' : 'Env A';
        condaService.setup(c => c.getCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve({ name: envName, path: path.dirname(pythonPath) }));

        const activationCommands = await new CondaActivationCommandProvider(serviceContainer.object).getActivationCommands(undefined, shellType);
        let expectedActivationCommamnd: string[] | undefined;
        switch (shellType) {
            case TerminalShellType.powershell:
            case TerminalShellType.powershellCore: {
                expectedActivationCommamnd = undefined;
                break;
            }
            case TerminalShellType.fish: {
                expectedActivationCommamnd = [`conda activate ${envName.toCommandArgument()}`];
                break;
            }
            default: {
                expectedActivationCommamnd = isWindows ? [`activate ${envName.toCommandArgument()}`] : [`source activate ${envName.toCommandArgument()}`];
                break;
            }
        }
        if (expectedActivationCommamnd) {
            expect(activationCommands).to.deep.equal(expectedActivationCommamnd, 'Incorrect Activation command');
        } else {
            expect(activationCommands).to.equal(undefined, 'Incorrect Activation command');
        }
    }
    getNamesAndValues<TerminalShellType>(TerminalShellType).forEach(shellType => {
        test(`Conda activation command for shell ${shellType.name} on (windows)`, async () => {
            const pythonPath = path.join('c', 'users', 'xyz', '.conda', 'envs', 'enva', 'python.exe');
            await expectNoCondaActivationCommandForPowershell(true, false, false, pythonPath, shellType.value);
        });

        test(`Conda activation command for shell ${shellType.name} on (linux)`, async () => {
            const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'bin', 'python');
            await expectNoCondaActivationCommandForPowershell(false, false, true, pythonPath, shellType.value);
        });

        test(`Conda activation command for shell ${shellType.name} on (mac)`, async () => {
            const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'bin', 'python');
            await expectNoCondaActivationCommandForPowershell(false, true, false, pythonPath, shellType.value);
        });
    });
    getNamesAndValues<TerminalShellType>(TerminalShellType).forEach(shellType => {
        test(`Conda activation command for shell ${shellType.name} on (windows), containing spaces in environment name`, async () => {
            const pythonPath = path.join('c', 'users', 'xyz', '.conda', 'envs', 'enva', 'python.exe');
            await expectNoCondaActivationCommandForPowershell(true, false, false, pythonPath, shellType.value, true);
        });

        test(`Conda activation command for shell ${shellType.name} on (linux), containing spaces in environment name`, async () => {
            const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'bin', 'python');
            await expectNoCondaActivationCommandForPowershell(false, false, true, pythonPath, shellType.value, true);
        });

        test(`Conda activation command for shell ${shellType.name} on (mac), containing spaces in environment name`, async () => {
            const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'bin', 'python');
            await expectNoCondaActivationCommandForPowershell(false, true, false, pythonPath, shellType.value, true);
        });
    });
    async function expectCondaActivationCommand(isWindows: boolean, isOsx: boolean, isLinux: boolean, pythonPath: string) {
        terminalSettings.setup(t => t.activateEnvironment).returns(() => true);
        platformService.setup(p => p.isLinux).returns(() => isLinux);
        platformService.setup(p => p.isWindows).returns(() => isWindows);
        platformService.setup(p => p.isMac).returns(() => isOsx);
        condaService.setup(c => c.isCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve(true));
        pythonSettings.setup(s => s.pythonPath).returns(() => pythonPath);
        condaService.setup(c => c.getCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve({ name: 'EnvA', path: path.dirname(pythonPath) }));

        const expectedActivationCommand = isWindows ? ['activate EnvA'] : ['source activate EnvA'];
        const activationCommands = await terminalHelper.getEnvironmentActivationCommands(TerminalShellType.bash, undefined);
        expect(activationCommands).to.deep.equal(expectedActivationCommand, 'Incorrect Activation command');
    }

    test('If environment is a conda environment, ensure conda activation command is sent (windows)', async () => {
        const pythonPath = path.join('c', 'users', 'xyz', '.conda', 'envs', 'enva', 'python.exe');
        fileSystem.setup(f => f.directoryExists(TypeMoq.It.isValue(path.join(path.dirname(pythonPath), 'conda-meta')))).returns(() => Promise.resolve(true));
        await expectCondaActivationCommand(true, false, false, pythonPath);
    });

    test('If environment is a conda environment, ensure conda activation command is sent (linux)', async () => {
        const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'bin', 'python');
        fileSystem.setup(f => f.directoryExists(TypeMoq.It.isValue(path.join(path.dirname(pythonPath), '..', 'conda-meta')))).returns(() => Promise.resolve(true));
        await expectCondaActivationCommand(false, false, true, pythonPath);
    });

    test('If environment is a conda environment, ensure conda activation command is sent (osx)', async () => {
        const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'bin', 'python');
        fileSystem.setup(f => f.directoryExists(TypeMoq.It.isValue(path.join(path.dirname(pythonPath), '..', 'conda-meta')))).returns(() => Promise.resolve(true));
        await expectCondaActivationCommand(false, true, false, pythonPath);
    });

    test('Get activation script command if environment is not a conda environment', async () => {
        const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'bin', 'python');
        terminalSettings.setup(t => t.activateEnvironment).returns(() => true);
        condaService.setup(c => c.isCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve(false));
        pythonSettings.setup(s => s.pythonPath).returns(() => pythonPath);

        const mockProvider = TypeMoq.Mock.ofType<ITerminalActivationCommandProvider>();
        serviceContainer.setup(c => c.getAll(TypeMoq.It.isValue(ITerminalActivationCommandProvider), TypeMoq.It.isAny())).returns(() => [mockProvider.object]);
        mockProvider.setup(p => p.isShellSupported(TypeMoq.It.isAny())).returns(() => true);
        mockProvider.setup(p => p.getActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(['mock command']));

        const expectedActivationCommand = ['mock command'];
        when(bash.isShellSupported(anything())).thenReturn(true);
        when(bash.getActivationCommands(anything(), TerminalShellType.bash)).thenResolve(expectedActivationCommand);

        const activationCommands = await terminalHelper.getEnvironmentActivationCommands(TerminalShellType.bash, undefined);

        expect(activationCommands).to.deep.equal(expectedActivationCommand, 'Incorrect Activation command');
    });
    async function expectActivationCommandIfCondaDetectionFails(isWindows: boolean, isOsx: boolean, isLinux: boolean, pythonPath: string, condaEnvsPath: string) {
        terminalSettings.setup(t => t.activateEnvironment).returns(() => true);
        platformService.setup(p => p.isLinux).returns(() => isLinux);
        platformService.setup(p => p.isWindows).returns(() => isWindows);
        platformService.setup(p => p.isMac).returns(() => isOsx);
        condaService.setup(c => c.isCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve(true));
        condaService.setup(c => c.isCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve(false));
        pythonSettings.setup(s => s.pythonPath).returns(() => pythonPath);

        when(bash.isShellSupported(anything())).thenReturn(true);
        when(bash.getActivationCommands(anything(), TerminalShellType.bash)).thenResolve(['mock command']);

        const expectedActivationCommand = ['mock command'];
        const activationCommands = await terminalHelper.getEnvironmentActivationCommands(TerminalShellType.bash, undefined);
        expect(activationCommands).to.deep.equal(expectedActivationCommand, 'Incorrect Activation command');
    }

    test('If environment is a conda environment and environment detection fails, ensure activatino of script is sent (windows)', async () => {
        const pythonPath = path.join('c', 'users', 'xyz', '.conda', 'envs', 'enva', 'python.exe');
        const condaEnvDir = path.join('c', 'users', 'xyz', '.conda', 'envs');
        fileSystem.setup(f => f.directoryExists(TypeMoq.It.isValue(path.join(path.dirname(pythonPath), 'conda-meta')))).returns(() => Promise.resolve(true));
        await expectActivationCommandIfCondaDetectionFails(true, false, false, pythonPath, condaEnvDir);
    });

    test('If environment is a conda environment and environment detection fails, ensure activatino of script is sent (osx)', async () => {
        const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'python');
        const condaEnvDir = path.join('users', 'xyz', '.conda', 'envs');
        fileSystem.setup(f => f.directoryExists(TypeMoq.It.isValue(path.join(path.dirname(pythonPath), '..', 'conda-meta')))).returns(() => Promise.resolve(true));
        await expectActivationCommandIfCondaDetectionFails(false, true, false, pythonPath, condaEnvDir);
    });

    test('If environment is a conda environment and environment detection fails, ensure activatino of script is sent (linux)', async () => {
        const pythonPath = path.join('users', 'xyz', '.conda', 'envs', 'enva', 'python');
        const condaEnvDir = path.join('users', 'xyz', '.conda', 'envs');
        fileSystem.setup(f => f.directoryExists(TypeMoq.It.isValue(path.join(path.dirname(pythonPath), '..', 'conda-meta')))).returns(() => Promise.resolve(true));
        await expectActivationCommandIfCondaDetectionFails(false, false, true, pythonPath, condaEnvDir);
    });

    test('Return undefined if unable to get activation command', async () => {
        const pythonPath = path.join('c', 'users', 'xyz', '.conda', 'envs', 'enva', 'python.exe');

        terminalSettings.setup(t => t.activateEnvironment).returns(() => true);
        condaService.setup(c => c.isCondaEnvironment(TypeMoq.It.isAny())).returns(() => Promise.resolve(false));

        pythonSettings.setup(s => s.pythonPath).returns(() => pythonPath);

        const mockProvider = TypeMoq.Mock.ofType<ITerminalActivationCommandProvider>();
        serviceContainer.setup(c => c.getAll(TypeMoq.It.isValue(ITerminalActivationCommandProvider), TypeMoq.It.isAny())).returns(() => [mockProvider.object]);
        mockProvider.setup(p => p.isShellSupported(TypeMoq.It.isAny())).returns(() => true);
        mockProvider.setup(p => p.getActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

        const activationCommands = await terminalHelper.getEnvironmentActivationCommands(TerminalShellType.bash, undefined);
        expect(activationCommands).to.equal(undefined, 'Incorrect Activation command');
    });

    const windowsTestPath = 'C:\\path\\to';
    const windowsTestPathSpaces = 'C:\\the path\\to the command';

    type WindowsActivationTestParams = {
        testName: string;
        basePath: string;
        envName: string;
        expectedResult: string[] | undefined;
        expectedRawCmd: string;
        terminalKind: TerminalShellType;
    };

    const testsForWindowsActivation: WindowsActivationTestParams[] =
        [
            {
                testName: 'Activation uses full path on windows for powershell',
                basePath: windowsTestPath,
                envName: 'TesterEnv',
                expectedResult: undefined,
                expectedRawCmd: `${path.join(windowsTestPath, 'activate')}`,
                terminalKind: TerminalShellType.powershell
            },
            {
                testName: 'Activation uses full path with spaces on windows for powershell',
                basePath: windowsTestPathSpaces,
                envName: 'TesterEnv',
                expectedResult: undefined,
                expectedRawCmd: `"${path.join(windowsTestPathSpaces, 'activate')}"`,
                terminalKind: TerminalShellType.powershell
            },
            {
                testName: 'Activation uses full path on windows under powershell, environment name has spaces',
                basePath: windowsTestPath,
                envName: 'The Tester Environment',
                expectedResult: undefined,
                expectedRawCmd: `${path.join(windowsTestPath, 'activate')}`,
                terminalKind: TerminalShellType.powershell
            },
            {
                testName: 'Activation uses full path on windows for powershell-core',
                basePath: windowsTestPath,
                envName: 'TesterEnv',
                expectedResult: undefined,
                expectedRawCmd: `${path.join(windowsTestPath, 'activate')}`,
                terminalKind: TerminalShellType.powershellCore
            },
            {
                testName: 'Activation uses full path with spaces on windows for powershell-core',
                basePath: windowsTestPathSpaces,
                envName: 'TesterEnv',
                expectedResult: undefined,
                expectedRawCmd: `"${path.join(windowsTestPathSpaces, 'activate')}"`,
                terminalKind: TerminalShellType.powershellCore
            },
            {
                testName: 'Activation uses full path on windows for powershell-core, environment name has spaces',
                basePath: windowsTestPath,
                envName: 'The Tester Environment',
                expectedResult: undefined,
                expectedRawCmd: `${path.join(windowsTestPath, 'activate')}`,
                terminalKind: TerminalShellType.powershellCore
            },
            {
                testName: 'Activation uses full path on windows for cmd.exe',
                basePath: windowsTestPath,
                envName: 'TesterEnv',
                expectedResult: [`${path.join(windowsTestPath, 'activate')} TesterEnv`],
                expectedRawCmd: `${path.join(windowsTestPath, 'activate')}`,
                terminalKind: TerminalShellType.commandPrompt
            },
            {
                testName: 'Activation uses full path with spaces on windows for cmd.exe',
                basePath: windowsTestPathSpaces,
                envName: 'TesterEnv',
                expectedResult: [`"${path.join(windowsTestPathSpaces, 'activate')}" TesterEnv`],
                expectedRawCmd: `"${path.join(windowsTestPathSpaces, 'activate')}"`,
                terminalKind: TerminalShellType.commandPrompt
            },
            {
                testName: 'Activation uses full path on windows for cmd.exe, environment name has spaces',
                basePath: windowsTestPath,
                envName: 'The Tester Environment',
                expectedResult: [`${path.join(windowsTestPath, 'activate')} "The Tester Environment"`],
                expectedRawCmd: `${path.join(windowsTestPath, 'activate')}`,
                terminalKind: TerminalShellType.commandPrompt
            }
        ];

    testsForWindowsActivation.forEach((testParams: WindowsActivationTestParams) => {
        test(testParams.testName, async () => {
            // each test simply tests the base windows activate command,
            // and then the specific result from the terminal selected.
            const servCnt = TypeMoq.Mock.ofType<IServiceContainer>();
            const condaSrv = TypeMoq.Mock.ofType<ICondaService>();
            condaSrv.setup(c => c.getCondaFile())
                .returns(async () => {
                    return path.join(testParams.basePath, 'conda.exe');
                });
            servCnt.setup(s => s.get(TypeMoq.It.isValue(ICondaService), TypeMoq.It.isAny()))
                .returns(() => condaSrv.object);

            const tstCmdProvider = new CondaActivationCommandProvider(servCnt.object);

            let result: string[] | undefined;

            if (testParams.terminalKind === TerminalShellType.commandPrompt) {
                result = await tstCmdProvider.getWindowsCommands(testParams.envName);
            } else {
                result = await tstCmdProvider.getPowershellCommands(testParams.envName, testParams.terminalKind);
            }
            expect(result).to.deep.equal(testParams.expectedResult, 'Specific terminal command is incorrect.');
        });
    });

});
