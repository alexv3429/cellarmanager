import { column, Schema, Table } from '@powersync/web';
// OR: import { column, Schema, Table } from '@powersync/react-native';

const households = new Table(
  {
    // id column (text) is automatically included
    name: column.text,
    created_at: column.text
  },
  { indexes: {} }
);

const household_members = new Table(
  {
    // id column (text) is automatically included
    household_id: column.text,
    user_id: column.text,
    role: column.text,
    created_at: column.text
  },
  { indexes: {} }
);

const wines = new Table(
  {
    // id column (text) is automatically included
    household_id: column.text,
    producer: column.text,
    cuvee: column.text,
    vintage: column.integer,
    color: column.text,
    appellation: column.text,
    area: column.text,
    format_ml: column.integer,
    wine_reference_id: column.text,
    wine_reference_type: column.text,
    created_at: column.text
  },
  { indexes: {} }
);

const cellars = new Table(
  {
    // id column (text) is automatically included
    household_id: column.text,
    name: column.text,
    is_active: column.integer,
    created_at: column.text
  },
  { indexes: {} }
);

const locations = new Table(
  {
    // id column (text) is automatically included
    household_id: column.text,
    cellar_id: column.text,
    code: column.text,
    is_active: column.integer,
    display_order: column.integer,
    capacity: column.integer,
    created_at: column.text
  },
  { indexes: {} }
);

const holdings = new Table(
  {
    // id column (text) is automatically included
    household_id: column.text,
    wine_id: column.text,
    location_id: column.text,
    quantity: column.integer,
    revision: column.integer,
    updated_at: column.text
  },
  { indexes: {} }
);

const inventory_operations = new Table(
  {
    // id column (text) is automatically included
    household_id: column.text,
    device_id: column.text,
    user_id: column.text,
    operation_type: column.text,
    wine_id: column.text,
    wine_producer: column.text,
    wine_cuvee: column.text,
    wine_vintage: column.integer,
    wine_color: column.text,
    wine_appellation: column.text,
    wine_area: column.text,
    wine_format_ml: column.integer,
    source_location_id: column.text,
    destination_location_id: column.text,
    quantity: column.integer,
    remove_reason: column.text,
    status: column.text,
    error_code: column.text,
    error_message: column.text,
    created_at_client: column.text,
    received_at_server: column.text
  },
  { indexes: {} }
);

const devices = new Table(
  {
    // id column (text) is automatically included
    household_id: column.text,
    user_id: column.text,
    name: column.text,
    created_at: column.text,
    last_seen_at: column.text
  },
  { indexes: {} }
);

export const AppSchema = new Schema({
  households,
  household_members,
  wines,
  cellars,
  locations,
  holdings,
  inventory_operations,
  devices
});

export type Database = (typeof AppSchema)['types'];
