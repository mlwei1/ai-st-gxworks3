/**
 * 仿真验证模块统一入口（M2）。
 */

export type {
  SimScenario,
  SimStep,
  SimValue,
  SimObservationFile,
  SimObservationStep,
  SimDiagnostic,
  SimValidateResult,
} from './scenario.ts';

export {
  formatSimDiagnostics,
  validateDeviceAddress,
  validateScenario,
} from './scenario.ts';

export type { SimDriver, SimRunResult, SimStepResult, SimMismatch } from './runner.ts';

export {
  formatSimReport,
  runScenarioWithDriver,
  runScenarioWithObservations,
  simCpu,
  valuesMatch,
} from './runner.ts';
