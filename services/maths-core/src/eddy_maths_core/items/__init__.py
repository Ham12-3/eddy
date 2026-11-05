"""Every item template, by id. Importing this registers every misconception rule too."""

from eddy_maths_core.items import algebra, data, geometry, number, ratio
from eddy_maths_core.items.base import Item, Template, TemplateError

ALL: list[Template] = [
    *number.TEMPLATES,
    *ratio.TEMPLATES,
    *algebra.TEMPLATES,
    *geometry.TEMPLATES,
    *data.TEMPLATES,
]
TEMPLATES: dict[str, Template] = {template.id: template for template in ALL}
if len(TEMPLATES) != len(ALL):
    raise RuntimeError("two item templates share an id")

__all__ = ["ALL", "TEMPLATES", "Item", "Template", "TemplateError"]
