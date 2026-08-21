from .analysis_pulse import NODE_TYPES as ANALYSIS_PULSE_NODE_TYPES, execute as execute_analysis_pulse
from .control_state import NODE_TYPES as CONTROL_STATE_NODE_TYPES, execute as execute_control_state
from .conversion_ui import NODE_TYPES as CONVERSION_UI_NODE_TYPES, execute as execute_conversion_ui
from .io_generate import NODE_TYPES as IO_GENERATE_NODE_TYPES, execute as execute_io_generate
from .plots import NODE_TYPES as PLOT_NODE_TYPES, execute as execute_plot
from .sequence import NODE_TYPES as SEQUENCE_NODE_TYPES, execute as execute_sequence
from .table_pandas import NODE_TYPES as TABLE_PANDAS_NODE_TYPES, execute as execute_table_pandas

HANDLERS = (
    (IO_GENERATE_NODE_TYPES, execute_io_generate),
    (TABLE_PANDAS_NODE_TYPES, execute_table_pandas),
    (SEQUENCE_NODE_TYPES, execute_sequence),
    (CONTROL_STATE_NODE_TYPES, execute_control_state),
    (ANALYSIS_PULSE_NODE_TYPES, execute_analysis_pulse),
    (PLOT_NODE_TYPES, execute_plot),
    (CONVERSION_UI_NODE_TYPES, execute_conversion_ui),
)

__all__ = ["HANDLERS"]
