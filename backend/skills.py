"""Skill registry, discovery, parsing, and execution manager for LLM Council.

Skills are modular, self-contained domain capability packages comprising:
  1. YAML frontmatter metadata (name, description, triggers, evaluation rubric, expert roles).
  2. Structured markdown guidelines and operational checklists.
  3. Optional bundled scripts and tools (in skills/<id>/scripts/).
"""

import logging
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
import yaml

from .config import SKILLS_DIR

logger = logging.getLogger("llm_council.skills")

# Regex to match YAML frontmatter between --- fences
_RE_FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


class SkillManager:
    """Manages skill discovery, loading, auto-matching, and file persistence."""

    def __init__(self, skills_dir: Optional[Path] = None):
        """Initialize the SkillManager.

        Args:
            skills_dir: Directory where skills are stored. Defaults to SKILLS_DIR.
        """
        self.skills_dir = skills_dir or SKILLS_DIR
        self._cache: Dict[str, Dict[str, Any]] = {}

    def _ensure_dir(self):
        """Ensure skills directory exists."""
        self.skills_dir.mkdir(parents=True, exist_ok=True)

    def _parse_skill_file(self, skill_file: Path) -> Optional[Dict[str, Any]]:
        """Parse a SKILL.md file into metadata and instruction content.

        Args:
            skill_file: Path to SKILL.md.

        Returns:
            Dict containing metadata and instructions, or None if invalid.
        """
        try:
            raw_text = skill_file.read_text(encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to read skill file {skill_file}: {e}")
            return None

        skill_id = skill_file.parent.name
        match = _RE_FRONTMATTER.match(raw_text)

        if match:
            frontmatter_raw = match.group(1)
            instructions = match.group(2).strip()
            try:
                metadata = yaml.safe_load(frontmatter_raw) or {}
            except Exception as e:
                logger.warning(f"Error parsing YAML frontmatter in {skill_file}: {e}")
                metadata = {}
        else:
            metadata = {}
            instructions = raw_text.strip()

        scripts_dir = skill_file.parent / "scripts"
        scripts = []
        if scripts_dir.is_dir():
            for p in scripts_dir.iterdir():
                if p.is_file() and not p.name.startswith("."):
                    scripts.append({
                        "name": p.name,
                        "path": str(p),
                        "is_executable": (p.suffix in {".py", ".sh", ".bash", ".js"}),
                    })

        return {
            "id": skill_id,
            "name": str(metadata.get("name") or skill_id.replace("-", " ").title()),
            "description": str(metadata.get("description") or ""),
            "triggers": list(metadata.get("triggers") or []),
            "evaluation_rubric": str(metadata.get("evaluation_rubric") or "").strip(),
            "expert_roles": list(metadata.get("expert_roles") or []),
            "instructions": instructions,
            "scripts": scripts,
            "is_builtin": False,
            "file_path": str(skill_file),
            "scripts_dir": str(scripts_dir) if scripts_dir.is_dir() else None,
        }

    def discover_skills(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Discover and index all available skills.

        Args:
            force_refresh: Whether to ignore memory cache and re-read from disk.

        Returns:
            List of skill summary dictionaries.
        """
        if self._cache and not force_refresh:
            return [
                {
                    "id": s["id"],
                    "name": s["name"],
                    "description": s["description"],
                    "triggers": s["triggers"],
                    "evaluation_rubric": s["evaluation_rubric"],
                    "expert_roles": s["expert_roles"],
                    "is_builtin": s["is_builtin"],
                    "scripts_count": len(s["scripts"]),
                }
                for s in self._cache.values()
            ]

        self._ensure_dir()
        self._cache.clear()

        summaries = []
        for item in sorted(self.skills_dir.iterdir()):
            if not item.is_dir():
                continue
            skill_md = item / "SKILL.md"
            if not skill_md.is_file():
                continue

            parsed = self._parse_skill_file(skill_md)
            if parsed:
                self._cache[parsed["id"]] = parsed
                summaries.append({
                    "id": parsed["id"],
                    "name": parsed["name"],
                    "description": parsed["description"],
                    "triggers": parsed["triggers"],
                    "evaluation_rubric": parsed["evaluation_rubric"],
                    "expert_roles": parsed["expert_roles"],
                    "is_builtin": parsed["is_builtin"],
                    "scripts_count": len(parsed["scripts"]),
                })

        return summaries

    def get_skill(self, skill_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve full details of a skill by ID.

        Args:
            skill_id: Slug identifier of the skill.

        Returns:
            Dictionary with metadata and full instructions, or None if not found.
        """
        if not self._cache:
            self.discover_skills()
        return self._cache.get(skill_id)

    def match_skill(self, query: str) -> Optional[Dict[str, Any]]:
        """Match a user prompt or query against skill triggers and keywords.

        Args:
            query: The user prompt or task description.

        Returns:
            The highest-scoring matching skill dict, or None if no match.
        """
        if not query or not query.strip():
            return None

        if not self._cache:
            self.discover_skills()

        query_lower = query.lower()
        query_words = set(re.findall(r"\b\w+\b", query_lower))

        best_skill: Optional[Dict[str, Any]] = None
        best_score = 0

        for skill in self._cache.values():
            score = 0
            # Direct ID match with word boundaries
            if re.search(r"\b" + re.escape(skill["id"]) + r"\b", query_lower):
                score += 5

            # Name match with word boundaries
            if re.search(r"\b" + re.escape(skill["name"].lower()) + r"\b", query_lower):
                score += 4

            # Trigger match (word match, multi-word phrase boundary, or stem match)
            for trigger in skill.get("triggers", []):
                t_lower = trigger.lower()
                if " " in t_lower or "-" in t_lower or "+" in t_lower:
                    if re.search(r"(?:^|\W)" + re.escape(t_lower) + r"(?:$|\W)", query_lower):
                        score += 3
                elif (
                    t_lower in query_words
                    or (
                        len(t_lower) >= 4
                        and any(w.startswith(t_lower.rstrip("y")) for w in query_words)
                    )
                ):
                    score += 3

            if score > best_score:
                best_score = score
                best_skill = skill

        # Minimum confidence threshold (requires at least one valid trigger/word match)
        if best_score >= 3:
            return best_skill
        return None

    def save_skill(
        self,
        skill_id: str,
        name: str,
        description: str,
        instructions: str,
        triggers: Optional[List[str]] = None,
        evaluation_rubric: Optional[str] = None,
        expert_roles: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Create or update a skill.

        Args:
            skill_id: Unique slug ID (alphanumeric, hyphens, underscores).
            name: Human-readable display name.
            description: Concise one-sentence summary.
            instructions: Full markdown guidelines and checklist.
            triggers: Optional list of keyword triggers.
            evaluation_rubric: Optional rubric string for Stage 2 evaluations.
            expert_roles: Optional list of Stage 1 expert role descriptions.

        Returns:
            The saved skill details dictionary.
        """
        clean_id = re.sub(r"[^a-zA-Z0-9_\-]", "-", skill_id.strip().lower()).strip("-")
        if not clean_id:
            raise ValueError("Invalid skill ID. Must contain alphanumeric characters.")

        self._ensure_dir()
        target_dir = self.skills_dir / clean_id
        target_dir.mkdir(parents=True, exist_ok=True)

        meta: Dict[str, Any] = {
            "name": name.strip() or clean_id.replace("-", " ").title(),
            "description": description.strip(),
            "triggers": [t.strip() for t in (triggers or []) if t.strip()],
        }
        if evaluation_rubric and evaluation_rubric.strip():
            meta["evaluation_rubric"] = evaluation_rubric.strip()
        if expert_roles:
            meta["expert_roles"] = [r.strip() for r in expert_roles if r.strip()]

        frontmatter_yaml = yaml.dump(meta, sort_keys=False, allow_unicode=True).strip()
        file_content = f"---\n{frontmatter_yaml}\n---\n\n{instructions.strip()}\n"

        target_file = target_dir / "SKILL.md"
        target_file.write_text(file_content, encoding="utf-8")

        # Invalidate cache and reload
        self.discover_skills(force_refresh=True)
        saved = self.get_skill(clean_id)
        if not saved:
            raise RuntimeError(f"Skill '{clean_id}' saved but failed to load.")
        return saved

    def delete_skill(self, skill_id: str) -> bool:
        """Delete a user-provided skill directory.

        Args:
            skill_id: The ID of the skill to delete.

        Returns:
            True if deleted, False if not found.
        """
        target_dir = self.skills_dir / skill_id
        if not target_dir.exists():
            return False

        shutil.rmtree(target_dir, ignore_errors=True)
        self.discover_skills(force_refresh=True)
        return True


# Global singleton skill manager
skill_manager = SkillManager()
